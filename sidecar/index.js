#!/usr/bin/env node
/**
 * LogicGuard AI Browser Sidecar
 * 
 * 这个脚本是 LogicGuard AI 的浏览器控制核心。
 * 
 * 工作流程：
 * 1. Tauri Rust 后端通过 std::process::Command 启动这个脚本
 * 2. 传入命令行参数告诉我们要做什么
 * 3. 我们连接到用户已打开的 Chrome（通过 CDP 协议）
 * 4. 执行操作，把结果以 JSON 格式输出到 stdout
 * 5. Rust 读取 stdout，解析 JSON，返回给前端
 * 
 * 为什么用这种方式？
 * - Playwright 是 Node.js 库，Rust 没有等效的稳定库
 * - 用子进程通信是跨语言协作的标准方式
 * - 每次命令独立运行，崩溃不影响主程序
 */

const { chromium } = require('playwright');

// 工具函数：输出成功结果并退出
function ok(data) {
  console.log(JSON.stringify({ ok: true, data }));
  process.exit(0);
}

// 工具函数：输出错误并退出
function fail(error) {
  console.log(JSON.stringify({ ok: false, error: String(error) }));
  process.exit(1);
}

// 从命令行参数里解析 key=value 形式的参数
// 例如: --port=9222 --selector=#btn-submit
function parseArgs(args) {
  const result = {};
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

async function main() {
  // process.argv = ['node', 'index.js', 'command', '--arg1=val1', ...]
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const cdpPort = args.port || '9222';

  // ─── 连接到 Chrome ───────────────────────────────────────────
  // 📚 这里是关键！我们不是启动一个新的浏览器，
  //    而是"接管"用户已经打开的 Chrome。
  //    Chrome 在 --remote-debugging-port 模式下会在这个端口提供 CDP 服务。
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  } catch (e) {
    fail(
      `无法连接到 Chrome CDP (端口 ${cdpPort})\n` +
      `请确保 Chrome 以以下命令启动：\n` +
      `chrome.exe --remote-debugging-port=${cdpPort}\n` +
      `错误详情: ${e.message}`
    );
    return;
  }

  // 获取当前打开的所有标签页
  // CDP 里叫 "context" (浏览器配置文件) → "page" (标签页)
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    await browser.close();
    fail('Chrome 里没有打开任何标签页');
    return;
  }

  // 取第一个 context 里的第一个 page（当前活跃标签页）
  const pages = contexts[0].pages();
  if (pages.length === 0) {
    await browser.close();
    fail('当前 Chrome 没有打开任何页面');
    return;
  }

  // 优先找指定 URL，否则过滤掉无关页面（扩展后台、空白页、开发者工具等）
  let page;
  if (args.url) {
    page = pages.find(p => p.url().includes(args.url)) || pages[0];
  } else {
    // 倒序查找（优先使用最近打开的页面），过滤掉不能被抓取的页面
    const validPages = [...pages].reverse().filter(p => {
      const u = p.url();
      return u && u !== 'about:blank' 
        && !u.startsWith('chrome-extension://') 
        && !u.startsWith('devtools://')
        && !u.startsWith('chrome://');
    });
    
    // 如果没有找到有效页面，就退回使用最后一个页面
    page = validPages.length > 0 ? validPages[0] : pages[pages.length - 1];
  }


  // ─── 执行具体命令 ─────────────────────────────────────────────
  try {
    switch (command) {

      // 📡 获取页面快照：返回当前页面的所有可交互元素
      case 'get_snapshot': {
        const url = page.url();
        const title = await page.title();

        let allElements = [];
        let globalIndex = 0;

        // 📚 企业系统（如 OA、ERP）经常使用 iframe 嵌套页面
        //    所以我们需要遍历当前页面的所有 frame（包括主页面和所有子 iframe）
        const frames = page.frames();
        
        for (const frame of frames) {
          try {
            // 在每个 frame 里执行提取逻辑
            const elements = await frame.$$eval(
              // 选择所有"可以点击/输入"的元素
              'a[href], button, input:not([type="hidden"]), select, textarea, ' +
              '[role="button"], [role="link"], [role="menuitem"], [role="tab"], ' +
              '[tabindex]:not([tabindex="-1"])',
              (els) => {
                return els.slice(0, 100).map((el) => {
                  let selector = '';
                  if (el.id) {
                    selector = `#${el.id}`;
                  } else if (el.getAttribute('data-testid')) {
                    selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
                  } else if (el.name) {
                    selector = `${el.tagName.toLowerCase()}[name="${el.name}"]`;
                  } else if (el.getAttribute('aria-label')) {
                    selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
                  } else {
                    const text = (el.textContent || '').trim().slice(0, 20);
                    selector = text
                      ? `${el.tagName.toLowerCase()}:has-text("${text}")`
                      : `${el.tagName.toLowerCase()}:nth-of-type(1)`; // 简化 fallback
                  }

                  return {
                    tag: el.tagName,
                    text: (el.textContent || el.value || '').trim().slice(0, 80),
                    type: el.type || undefined,
                    placeholder: el.placeholder || undefined,
                    role: el.getAttribute('role') || undefined,
                    ariaLabel: el.getAttribute('aria-label') || undefined,
                    disabled: el.disabled || false,
                    selector,
                    visible: el.offsetParent !== null,
                  };
                });
              }
            );

            // 给所有提取到的元素分配全局唯一的 index
            for (const el of elements) {
              if (!el.visible && !el.type) continue; // 稍微过滤掉一些不可见且无意义的元素
              el.index = globalIndex++;
              allElements.push(el);
            }
          } catch (e) {
            // 有些跨域 iframe 可能会报错，忽略它继续抓取下一个
            console.error('Frame 抓取失败 (跨域或销毁):', e.message);
          }
        }

        // 限制元素总数，防止传递给 LLM 的 Token 爆炸
        if (allElements.length > 200) {
          allElements = allElements.slice(0, 200);
        }

        ok({ url, title, interactiveElements: allElements });
        break;
      }

      // 🖱️ 点击元素
      case 'click': {
        const { selector, timeout = '5000' } = args;
        if (!selector) { fail('缺少参数: --selector'); return; }

        // 📚 waitForSelector 等待元素出现再点击，比直接 click 更稳定
        //    这也是 Healer 机制的基础：如果等待超时，我们捕获错误并报告给 AI
        await page.waitForSelector(selector, { timeout: parseInt(timeout) });
        await page.click(selector);
        ok({ action: 'click', selector, message: '点击成功' });
        break;
      }

      // ⌨️ 在输入框里输入文字
      case 'type': {
        const { selector, value = '', timeout = '5000' } = args;
        if (!selector) { fail('缺少参数: --selector'); return; }

        await page.waitForSelector(selector, { timeout: parseInt(timeout) });
        // 先清空再输入，避免追加到已有内容
        await page.fill(selector, value);
        ok({ action: 'type', selector, value, message: '输入成功' });
        break;
      }

      // 🌐 导航到新 URL
      case 'navigate': {
        const { url, timeout = '30000' } = args;
        if (!url) { fail('缺少参数: --url'); return; }

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: parseInt(timeout)
        });
        ok({ action: 'navigate', url, message: '导航成功', finalUrl: page.url() });
        break;
      }

      // 📋 Select 下拉框选择
      case 'select': {
        const { selector, value } = args;
        if (!selector || !value) { fail('缺少参数: --selector 或 --value'); return; }

        await page.waitForSelector(selector);
        await page.selectOption(selector, { label: value });
        ok({ action: 'select', selector, value, message: '选择成功' });
        break;
      }

      // ⏳ 等待某个元素出现（常用于等待页面跳转后的元素）
      case 'wait_for': {
        const { selector, timeout = '10000' } = args;
        if (!selector) { fail('缺少参数: --selector'); return; }

        await page.waitForSelector(selector, { timeout: parseInt(timeout) });
        ok({ action: 'wait_for', selector, message: '元素已出现' });
        break;
      }

      // 📸 截图（用于调试时查看当前页面状态）
      case 'screenshot': {
        const path = args.path || 'screenshot.png';
        await page.screenshot({ path, fullPage: false });
        ok({ action: 'screenshot', path, message: '截图保存成功' });
        break;
      }

      // 🔍 断言：检查某个元素是否存在或包含某文字
      case 'assert': {
        const { selector, contains } = args;
        if (!selector) { fail('缺少参数: --selector'); return; }

        const element = await page.$(selector);
        if (!element) {
          fail(`断言失败：页面上找不到元素 ${selector}`);
          return;
        }

        if (contains) {
          const text = await element.textContent();
          if (!text?.includes(contains)) {
            fail(`断言失败：元素 ${selector} 的文字不包含 "${contains}"，实际内容: "${text}"`);
            return;
          }
        }

        ok({ action: 'assert', selector, message: '断言通过' });
        break;
      }

      // ❓ 未知命令
      default:
        fail(`未知命令: ${command}。支持的命令: get_snapshot, click, type, navigate, select, wait_for, screenshot, assert`);
    }
  } catch (e) {
    // 📚 这里的错误信息非常重要！
    //    Healer 引擎会读取这些错误，发给 AI 分析，然后生成修复方案
    fail(`执行命令 "${command}" 失败: ${e.message}`);
  } finally {
    // 📚 注意：这里我们 disconnect 而不是 close
    //    close() 会关闭用户的 Chrome！
    //    disconnect() 只是断开我们的控制连接，Chrome 继续正常运行
    await browser.close(); // 对于 connectOverCDP，close() 实际上是 disconnect
  }
}

main();
