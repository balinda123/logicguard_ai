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

// 🌐 自动获取 Chrome 真实的 WebSocket 调试地址
async function getWsUrl(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const data = await res.json();
    return data.webSocketDebuggerUrl;
  } catch (e) {
    throw new Error(`无法获取 CDP WebSocket URL (请确认 Chrome 是否已在 ${port} 端口开启调试模式): ${e.message}`);
  }
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
        && !u.startsWith('chrome://')
        && !u.startsWith('chrome-error://');
    });
    
    // 如果没有找到有效页面，就退回使用最后一个页面
    page = validPages.length > 0 ? validPages[0] : pages[pages.length - 1];
  }


  // ─── 执行具体命令 ─────────────────────────────────────────────
  try {
    switch (command) {

      // 📡 获取页面快照（双引擎：无障碍树AX + DOM 互补）
      case 'get_snapshot': {
        const url = page.url();
        const title = await page.title();

        let allElements = [];
        let globalIndex = 0;

        // ═══════════════════════════════════════════════════════
        // 引擎1：Playwright 无障碍树 (AX Tree)
        // 能正确识别 Element UI / Ant Design / Vue 等自定义组件
        // 例如 el-select 会被识别为 role=combobox，accessible name="直属部门"
        // ═══════════════════════════════════════════════════════
        const AX_INTERACTIVE_ROLES = new Set([
          'button','link','textbox','combobox','listbox','option',
          'checkbox','radio','switch','tab','menuitem','menuitemcheckbox',
          'menuitemradio','treeitem','spinbutton','slider','searchbox',
        ]);

        function flattenAXNode(node, out, depth = 0) {
          if (!node) return;
          out.push({ ...node, depth });
          if (node.children) {
            for (const child of node.children) flattenAXNode(child, out, depth + 1);
          }
        }

        try {
          const axTree = await page.accessibility.snapshot({ interestingOnly: false });
          if (axTree) {
            const flatNodes = [];
            flattenAXNode(axTree, flatNodes);
            for (const node of flatNodes) {
              if (!AX_INTERACTIVE_ROLES.has(node.role)) continue;
              // 必须有可识别的 name 或 description（否则没有定位价值）
              const semantic = node.name || node.description || node.value || '';
              if (!semantic.trim()) continue;

              allElements.push({
                index: globalIndex++,
                tag: node.role.toUpperCase(),
                role: node.role,
                // accessibleName 是最重要的字段：这是用户肉眼看到的标签文字或 placeholder
                accessibleName: node.name || '',
                // description 通常对应 placeholder 或补充说明
                description: node.description || '',
                currentValue: node.value || '',
                text: node.name || node.description || '',
                disabled: node.disabled || false,
                visible: true,
                source: 'ax',  // 标记来自 AX 树
              });
            }
          }
        } catch (axErr) {
          console.warn('[sidecar] AX Tree 获取失败，使用纯 DOM 模式:', axErr.message);
        }

        // ═══════════════════════════════════════════════════════
        // 引擎2：DOM 提取（覆盖 AX 树可能遗漏的非语义元素）
        // ═══════════════════════════════════════════════════════
        const frames = page.frames();
        
        for (const frame of frames) {
          try {
            // 在每个 frame 里执行提取逻辑
            const elements = await frame.$$eval(
              // 选择所有"可以点击/输入"的元素，包括 Vue/React 常用的非标准菜单标签
              'a[href], button, input:not([type="hidden"]), select, textarea, ' +
              '[role="button"], [role="link"], [role="menuitem"], [role="tab"], ' +
              '[tabindex]:not([tabindex="-1"]), ' +
              'li, [class*="menu"], [class*="nav"], [class*="btn"], [class*="tab"]',
              (els) => {
                const results = [];
                for (const el of els) {
                  // 过滤掉不可见且没文本的无效容器
                  let text = (el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
                  
                  // 如果按钮没有文字（例如纯图标按钮），尝试从 HTML 结构中提取图标语义
                  if (!text && !el.placeholder && !el.getAttribute('aria-label')) {
                    const html = el.outerHTML.toLowerCase();
                    if (html.includes('search')) text = 'icon:search';
                    else if (html.includes('close')) text = 'icon:close';
                    else if (html.includes('add') || html.includes('plus')) text = 'icon:add';
                    else if (html.includes('edit')) text = 'icon:edit';
                    else if (html.includes('delete') || html.includes('trash')) text = 'icon:delete';
                    else if (html.includes('download')) text = 'icon:download';
                    else if (html.includes('upload')) text = 'icon:upload';
                    else continue; // 如果既没文字也没有已知图标特征，则丢弃
                  }

                  // 注入唯一标识符
                  let lgId = el.getAttribute('data-lg-id');
                  if (!lgId) {
                    lgId = `lg-${Math.random().toString(36).substring(2, 10)}`;
                    el.setAttribute('data-lg-id', lgId);
                  }
                  
                  const selector = `[data-lg-id="${lgId}"]`;

                  const rect = el.getBoundingClientRect();
                  
                  // 过滤掉不可见、或者是占据大半个屏幕的布局容器 (防止 Playwright 点击其中心时误触其他按钮)
                  if (rect.width === 0 || rect.height === 0) continue;
                  if (rect.width > window.innerWidth * 0.7 || rect.height > window.innerHeight * 0.7) continue;

                  // 提取关联 label 文字（SELECT 下拉框通常有关联的 label，这是 AI 识别"部门筛选"的关键）
                  let labelText = '';
                  if (el.id) {
                    const label = document.querySelector(`label[for="${el.id}"]`);
                    if (label) labelText = label.textContent?.trim().slice(0, 30) || '';
                  }
                  if (!labelText) {
                    // 尝试向上找最近的父级 label 或带有文字的前置兄弟元素
                    const parent = el.parentElement;
                    if (parent) {
                      const prevSibling = el.previousElementSibling;
                      if (prevSibling && prevSibling.tagName === 'LABEL') {
                        labelText = prevSibling.textContent?.trim().slice(0, 30) || '';
                      } else if (parent.tagName === 'LABEL') {
                        // label 包裹了 input 的情况
                        labelText = parent.textContent?.replace(el.textContent || '', '').trim().slice(0, 30) || '';
                      } else {
                        // 取父级容器里除自身之外的第一个文字节点（常见于 form-item 包裹结构）
                        const grandparent = parent.parentElement;
                        if (grandparent) {
                          const siblingLabel = grandparent.querySelector('label, .label, [class*="label"]');
                          if (siblingLabel && siblingLabel !== el) {
                            labelText = siblingLabel.textContent?.trim().slice(0, 30) || '';
                          }
                        }
                      }
                    }
                  }

                  // 对于 SELECT，还额外提取所有 option 的文字（让 AI 知道可以选哪些值）
                  let options = undefined;
                  if (el.tagName === 'SELECT') {
                    options = Array.from(el.options || [])
                      .map(o => o.text?.trim())
                      .filter(Boolean)
                      .slice(0, 10) // 最多取前 10 个选项
                      .join('|');
                  }

                  results.push({
                    tag: el.tagName,
                    text,
                    type: el.type || undefined,
                    placeholder: el.placeholder || undefined,
                    role: el.getAttribute('role') || undefined,
                    ariaLabel: el.getAttribute('aria-label') || undefined,
                    disabled: el.disabled || false,
                    selector,
                    visible: el.offsetParent !== null,
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    labelText: labelText || undefined,  // 关联的 label 文字
                    options: options || undefined,       // SELECT 的可选项列表
                  });
                }
                return results;

              }
            );

            // 给所有提取到的元素分配全局唯一的 index
            for (const el of elements) {
              // 放宽可见性过滤：如果元素不可见，但它是带有文本的按钮/链接，我们依然保留它。
              // 这样大模型就能看到隐藏在下拉菜单里的子页面（例如花名册）
              if (!el.visible && !el.type && !el.text) continue; 
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

      // ⏳ 智能等待页面加载和渲染完成（处理 Loading 遮罩层）
      async function smartWaitForLoading(page) {
        try {
          // 1. 等待短暂延迟以允许任何 loading mask 挂载或渲染出来
          await page.waitForTimeout(300);
          
          // 2. 检查是否有常见的 Loading 遮罩层/加载框，并等待其消失
          const loadingSelector = '.el-loading-mask, .ant-spin, .loading-mask, .loading-indicator, .loading, .loading-spinner';
          const loaders = page.locator(loadingSelector);
          const count = await loaders.count();
          if (count > 0) {
            for (let i = 0; i < count; i++) {
              await loaders.nth(i).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            }
          }
          
          // 3. 多等一会儿确保数据渲染完毕并稳定
          await page.waitForTimeout(600);
        } catch (e) {
          // 容错，不阻碍主流程
        }
      }

      // 🤖 Stagehand AI 智能定位愈合机制
      async function runStagehandHealer(cdpPort, action, strategy, value) {
        const logFile = require('path').join(__dirname, '../stagehand_healer.log');
        const fs = require('fs');
        const appendLog = (msg) => {
          try {
            fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
          } catch(e) {}
        };

        try {
          appendLog(`Stagehand 愈合启动: cdpPort=${cdpPort}, action=${action}, strategy=${strategy}, value=${value}`);
          
          // 动态导入 Stagehand (ESM 模块)
          const { Stagehand } = await import('@browserbasehq/stagehand');
          
          // 获取 Rust 端传递过来的 LLM 配置环境变量
          const provider = process.env.LLM_PROVIDER || 'openai';
          const model = process.env.LLM_MODEL || 'gpt-4o-mini';
          const apiKey = process.env.LLM_API_KEY;
          const baseUrl = process.env.LLM_BASE_URL;

          appendLog(`LLM 原始变量: provider=${provider}, model=${model}, apiKey=${apiKey ? '***' : 'undefined'}, baseUrl=${baseUrl}`);

          // 适配 Stagehand 的 modelName 格式（例如 google/gemini-2.0-flash 或 openai/gpt-4o）
          let modelName = `${provider}/${model}`;
          if (provider === 'gemini') {
            modelName = `google/${model}`;
          } else if (provider === 'openai_compat') {
            modelName = `openai/${model}`;
          } else if (provider === 'ollama') {
            // Ollama 模式需要 'ollama/' 前缀
            modelName = `ollama/${model}`;
          }

          appendLog(`计算得出的 modelName: ${modelName}`);

          const wsUrl = await getWsUrl(cdpPort);
          const stagehandOptions = {
            env: "LOCAL",
            localBrowserLaunchOptions: {
              cdpUrl: wsUrl,
            },
            modelName: modelName,
            modelClientOptions: {
              apiKey: apiKey || "temp-api-key", // Ollama or custom local servers sometimes require a dummy key
              baseURL: baseUrl,
            }
          };
          
          appendLog(`Stagehand 初始化参数: ${JSON.stringify(stagehandOptions, null, 2)}`);

          const stagehand = new Stagehand(stagehandOptions);
          await stagehand.init();

          // 翻译动作指令为自然语言描述以传给 Stagehand AI
          let instruction = '';
          if (action === 'click') {
            instruction = `Click the element matching ${strategy} with value "${value}"`;
          } else if (action === 'fill') {
            instruction = `Type/fill "${value}" into the input field matching ${strategy}`;
          } else if (action === 'press') {
            instruction = `Press "${value}" on the element matching ${strategy}`;
          } else if (action === 'selectOption') {
            instruction = `Select option "${value}" on the select/dropdown element matching ${strategy}`;
          } else {
            instruction = `Perform ${action} on the element matching ${strategy} with value "${value}"`;
          }

          appendLog(`AI 执行指令: "${instruction}"`);
          await stagehand.act(instruction);

          await stagehand.close();
          appendLog(`Stagehand 愈合执行成功！`);
          return true;
        } catch (e) {
          appendLog(`Stagehand 发生错误: ${e.message}\n${e.stack}`);
          console.error(`❌ [Stagehand] AI 愈合过程发生错误:`, e.message);
          return false;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // 核心方法：7级瀑布式降级定位 + 跨 frame 支持
      // 彻底解决 Element UI / Ant Design 等组件库的定位失败问题
      // ═══════════════════════════════════════════════════════════════
      async function performInAnyFrame(page, action, selectorOrStrategy, value) {
        // ── 💡 解析策略与定位值到外层作用域（让 AI 愈合机制能正确读取） ──
        let strat = selectorOrStrategy;
        let locVal = value;
        if (selectorOrStrategy && selectorOrStrategy.includes(':') && !selectorOrStrategy.startsWith('[') && !selectorOrStrategy.startsWith('.') && !selectorOrStrategy.startsWith('#')) {
          const colonIdx = selectorOrStrategy.indexOf(':');
          strat = selectorOrStrategy.slice(0, colonIdx);
          locVal = selectorOrStrategy.slice(colonIdx + 1);
        }

        // ── 视觉反馈脚本（注入到浏览器页面，高亮被点击的元素）──
        const visualCueScript = (node) => {
          try {
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const cursor = document.createElement('div');
            cursor.style.cssText = `
              position:fixed; pointer-events:none; z-index:2147483647;
              left:${rect.left + rect.width/2 - 15}px; top:${rect.top + rect.height/2 - 15}px;
              width:30px; height:30px; border-radius:50%;
              background:rgba(239,68,68,0.4); border:2px solid rgb(239,68,68);
              box-shadow:0 0 15px rgba(239,68,68,0.6);
              transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);
            `;
            const label = document.createElement('span');
            label.innerText = '🤖 AI 操作';
            label.style.cssText = 'position:absolute;top:-25px;left:-20px;background:#1e293b;color:#fff;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:bold;white-space:nowrap;';
            cursor.appendChild(label);
            document.body.appendChild(cursor);
            setTimeout(() => { cursor.style.transform = 'scale(0.3)'; cursor.style.background = 'rgba(239,68,68,0.9)'; }, 50);
            setTimeout(() => cursor.remove(), 1500);
          } catch(e) {}
        };

        // ── 在指定上下文(page/frame)中，按优先级尝试多种定位策略 ──
        async function tryLocateAndAct(ctx, strategy, val, actVal) {
          // 7级瀑布式定位候选列表（从最精准到最宽松）
          const candidates = [];

          switch (strat) {
            case 'placeholder':
              // 1. Playwright 语义 API（能处理 Vue/React 组件的 placeholder）
              candidates.push(() => ctx.getByPlaceholder(locVal, { exact: false }));
              // 2. HTML 标准 placeholder 属性
              candidates.push(() => ctx.locator(`[placeholder*="${locVal}"]`));
              // 3. aria-placeholder (某些框架用这个)
              candidates.push(() => ctx.locator(`[aria-placeholder*="${locVal}"]`));
              // 4. 可见文字匹配（el-select 的 placeholder 是 span 文字，非属性）
              candidates.push(() => ctx.getByText(locVal, { exact: true }));
              // 5. class 包含 placeholder 的元素的可见文字
              candidates.push(() => ctx.locator(`[class*="placeholder"]`).filter({ hasText: locVal }));
              break;

            case 'aria-label':
              candidates.push(() => ctx.getByLabel(locVal, { exact: false }));
              candidates.push(() => ctx.locator(`[aria-label*="${locVal}"]`));
              candidates.push(() => ctx.locator(`[title*="${locVal}"]`));
              break;

            case 'text':
              // 1. 极高优先级：限制在展开的下拉框/级联浮层内查找（防止误触左侧同名的部门树导航栏！）
              candidates.push(() => ctx.locator('.el-popper, .el-select-dropdown, .el-cascader__dropdown, .ant-select-dropdown, .ant-cascader-menus, [class*="dropdown"]')
                .locator(`text="${locVal}"`));
              candidates.push(() => ctx.locator('.el-popper, .el-select-dropdown, .el-cascader__dropdown, .ant-select-dropdown, .ant-cascader-menus, [class*="dropdown"]')
                .getByRole('option', { name: locVal }));
              candidates.push(() => ctx.locator('.el-cascader-node, .el-select-dropdown__item, .ant-select-item, .ant-cascader-menu-item')
                .filter({ hasText: locVal }));

              // 2. 普通定位策略
              candidates.push(() => ctx.getByRole('option', { name: locVal }));
              candidates.push(() => ctx.getByRole('menuitem', { name: locVal }));
              candidates.push(() => ctx.getByRole('treeitem', { name: locVal }));
              candidates.push(() => ctx.getByText(locVal, { exact: true }));
              candidates.push(() => ctx.locator(`[role="option"]:has-text("${locVal}")`) );
              candidates.push(() => ctx.locator(`li:has-text("${locVal}")`) );
              candidates.push(() => ctx.locator(`[class*="item"]:has-text("${locVal}")`) );
              candidates.push(() => ctx.getByText(locVal, { exact: false }));
              break;

            case 'accessible-name':
            case 'role':
              // 语义角色定位（AX 树抓到的元素使用此策略）
              candidates.push(() => ctx.getByRole('combobox', { name: locVal }));
              candidates.push(() => ctx.getByRole('textbox', { name: locVal }));
              candidates.push(() => ctx.getByRole('button', { name: locVal }));
              candidates.push(() => ctx.getByLabel(locVal, { exact: false }));
              candidates.push(() => ctx.getByText(locVal, { exact: true }));
              break;

            case 'name':
              candidates.push(() => ctx.locator(`[name="${locVal}"]`));
              candidates.push(() => ctx.locator(`[name*="${locVal}"]`));
              break;

            case 'testid':
              candidates.push(() => ctx.getByTestId(locVal));
              candidates.push(() => ctx.locator(`[data-testid="${locVal}"]`));
              break;

            default:
              // 原始 CSS 选择器（data-lg-id 或任何 CSS）
              candidates.push(() => ctx.locator(strat === 'selector' ? locVal : (selectorOrStrategy)));
              break;
          }

          for (const getLocator of candidates) {
            try {
              const baseLocator = getLocator();
              const count = await baseLocator.count();
              if (count === 0) continue;

              // 🌟 智能可见性筛选：优先寻找当前页面可见的元素，防止点击了侧边栏等隐藏元素！
              let targetLoc = baseLocator.first();
              let isVisible = await targetLoc.isVisible().catch(() => false);
              
              if (!isVisible && count > 1) {
                for (let i = 0; i < count; i++) {
                  const tempLoc = baseLocator.nth(i);
                  if (await tempLoc.isVisible().catch(() => false)) {
                    targetLoc = tempLoc;
                    isVisible = true;
                    break;
                  }
                }
              }

              // 找到了！执行视觉反馈
              await targetLoc.evaluate(visualCueScript).catch(() => {});

              // 根据动作类型执行操作
              if (action === 'click') {
                await targetLoc.click({ force: true, timeout: 3000 });
              } else if (action === 'hover') {
                await targetLoc.hover({ force: true });
              } else if (action === 'fill') {
                // 🌟 自适应输入增强：如果目标元素是 span/div 等非可输入元素，尝试寻找其内部或相邻的 input 元素，确保 Vue/React 自定义选择器输入成功！
                let inputLoc = targetLoc;
                const tagName = await targetLoc.evaluate(node => node.tagName.toLowerCase()).catch(() => '');
                if (tagName !== 'input' && tagName !== 'textarea') {
                  const inputCount = await targetLoc.locator('input').count();
                  if (inputCount > 0) {
                    inputLoc = targetLoc.locator('input').first();
                  } else {
                    const siblingInputCount = await targetLoc.locator('xpath=..//input').count();
                    if (siblingInputCount > 0) {
                      inputLoc = targetLoc.locator('xpath=..//input').first();
                    }
                  }
                }
                await inputLoc.fill(actVal || '', { force: true });
              } else if (action === 'press') {
                // 🌟 自适应按键增强
                let inputLoc = targetLoc;
                const tagName = await targetLoc.evaluate(node => node.tagName.toLowerCase()).catch(() => '');
                if (tagName !== 'input' && tagName !== 'textarea') {
                  const inputCount = await targetLoc.locator('input').count();
                  if (inputCount > 0) {
                    inputLoc = targetLoc.locator('input').first();
                  } else {
                    const siblingInputCount = await targetLoc.locator('xpath=..//input').count();
                    if (siblingInputCount > 0) {
                      inputLoc = targetLoc.locator('xpath=..//input').first();
                    }
                  }
                }
                await inputLoc.press(actVal || 'Enter');
              } else if (action === 'selectOption') {
                await targetLoc.selectOption(actVal || '', { force: true });
              }
              return true;
            } catch(e) {
              // 本候选失败，继续下一个
            }
          }
          return false; // 本上下文所有候选都失败
        }

        // 🌟 动态重试机制：在 2.5 秒内循环重试瀑布流，彻底解决因 DOM 载入慢、下拉动画未完成导致的定位失败！
        const startTime = Date.now();
        const timeoutMs = 2500;
        let success = false;
        
        while (Date.now() - startTime < timeoutMs) {
          try {
            // 1. 主页面尝试
            const mainOk = await tryLocateAndAct(page, selectorOrStrategy, selectorOrStrategy, value);
            if (mainOk) {
              success = true;
              break;
            }

            // 2. 遍历所有 iframe
            for (const frame of page.frames()) {
              if (frame === page.mainFrame()) continue;
              try {
                const frameOk = await tryLocateAndAct(frame, selectorOrStrategy, selectorOrStrategy, value);
                if (frameOk) {
                  success = true;
                  break;
                }
              } catch(e) {}
            }
            if (success) break;
          } catch (localErr) {
            console.warn(`[本地尝试异常] ${localErr.message}`);
          }
          
          // 等待 200ms 后重试下一次循环
          await page.waitForTimeout(200);
        }

        if (success) return true;

        // 🌟 核心防御性边缘处理：检测“暂无数据”等业务空状态，避免把列表无数据的正常业务误判为脚本执行错误！
        const isEmpty = await page.evaluate(() => {
          const emptySelectors = [
            '.ant-empty', '.ant-table-empty', '.ant-table-placeholder', 
            '.el-empty', '.el-table__empty-text', '.el-table__empty-block',
            '[class*="empty"]', '[class*="nodata"]'
          ];
          for (const sel of emptySelectors) {
            const el = document.querySelector(sel);
            if (el && el.getBoundingClientRect().width > 0) return true;
          }
          const text = document.body.innerText || '';
          const emptyKeywords = ['暂无数据', '无数据', '没有数据', 'No Data', 'Empty', '0条', '共 0 条', '人数: 0人', '人数:0人'];
          for (const kw of emptyKeywords) {
            if (text.includes(kw)) return true;
          }
          return false;
        }).catch(() => false);

        if (isEmpty) {
          console.warn(`⚠️ [智能旁路] 定位失败，但检测到页面当前没有数据，已优雅跳过此操作！`);
          global.lgLastActionSkipped = true;
          global.lgLastActionReason = `⚠️ 检测到列表处于“暂无数据”状态，已智能跳过后续操作。`;
          return true;
        }

        // 💡 7级本地定位全部失败，进入 Stagehand AI 自动愈合机制！
        console.warn(`⚠️ 本地定位全部失败，正在启动 Stagehand AI 智能愈合机制...`);
        const healed = await runStagehandHealer(cdpPort, action, strat, locVal);
        if (healed) {
          return true;
        }

        throw new Error(`[本地与 AI 定位均失败] strategy="${selectorOrStrategy}"`);
      }

      // 🖱️ 点击元素
      case 'click': {
        const { selector } = args;
        if (!selector) { fail('缺少参数: --selector'); return; }

        await performInAnyFrame(page, 'click', selector);
        await smartWaitForLoading(page);
        
        if (global.lgLastActionSkipped) {
          const msg = global.lgLastActionReason || '⚠️ 检测到业务空数据状态，已智能跳过操作';
          global.lgLastActionSkipped = false;
          global.lgLastActionReason = null;
          ok({ action: 'click', selector, message: msg });
        } else {
          ok({ action: 'click', selector, message: '点击成功并等待稳定' });
        }
        break;
      }
      // 🖱️ 悬停元素
      case 'hover': {
        const { selector } = args;
        if (!selector) { fail('缺少参数: --selector'); return; }

        await performInAnyFrame(page, 'hover', selector);
        
        if (global.lgLastActionSkipped) {
          const msg = global.lgLastActionReason || '⚠️ 检测到业务空数据状态，已智能跳过操作';
          global.lgLastActionSkipped = false;
          global.lgLastActionReason = null;
          ok({ action: 'hover', selector, message: msg });
        } else {
          ok({ action: 'hover', selector, message: '悬停成功' });
        }
        break;
      }

      // ⌨️ 在输入框里输入文字
      case 'type': {
        const { selector, value = '' } = args;
        if (!selector) { fail('缺少参数: --selector'); return; }

        await performInAnyFrame(page, 'fill', selector, value);
        
        if (global.lgLastActionSkipped) {
          const msg = global.lgLastActionReason || '⚠️ 检测到业务空数据状态，已智能跳过操作';
          global.lgLastActionSkipped = false;
          global.lgLastActionReason = null;
          ok({ action: 'type', selector, value, message: msg });
        } else {
          ok({ action: 'type', selector, value, message: '输入成功' });
        }
        break;
      }
      
      // ⌨️ 发送按键 (如 Enter)
      case 'press': {
        const { selector, key } = args;
        if (!selector || !key) { fail('缺少参数: --selector 或 --key'); return; }

        await performInAnyFrame(page, 'press', selector, key);
        await smartWaitForLoading(page);
        
        if (global.lgLastActionSkipped) {
          const msg = global.lgLastActionReason || '⚠️ 检测到业务空数据状态，已智能跳过操作';
          global.lgLastActionSkipped = false;
          global.lgLastActionReason = null;
          ok({ action: 'press', selector, key, message: msg });
        } else {
          ok({ action: 'press', selector, key, message: '按键发送成功并等待稳定' });
        }
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

      // 📋 Select / 自定义下拉框点击选项
      case 'select': {
        const { selector, value } = args;
        if (!selector || !value) { fail('缺少参数: --selector 或 --value'); return; }

        // 先尝试原生 selectOption（适用于 HTML <select>）
        // 如果失败，fallback 到按文字 click（适用于 Vue/React 自定义下拉）
        try {
          await performInAnyFrame(page, 'selectOption', selector, value);
        } catch(e) {
          // 原生 select 失败，按文字点击选项（适用于自定义下拉框选项）
          await performInAnyFrame(page, 'click', `text:${value}`);
        }
        await smartWaitForLoading(page);
        
        if (global.lgLastActionSkipped) {
          const msg = global.lgLastActionReason || '⚠️ 检测到业务空数据状态，已智能跳过操作';
          global.lgLastActionSkipped = false;
          global.lgLastActionReason = null;
          ok({ action: 'select', selector, value, message: msg });
        } else {
          ok({ action: 'select', selector, value, message: '选择成功并等待稳定' });
        }
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

      // ═══════════════════════════════════════════════════════════════
      // 🤖 Stagehand-First 命令：直接用 AI 驱动浏览器操作
      // ═══════════════════════════════════════════════════════════════

      // ── 共用：从环境变量解析并构建 Stagehand model 配置 ──────────
      // 注意：act/observe/agent 都使用此逻辑，集中在一处避免重复和遗漏
      function buildStagehandModelConfig() {
        let provider = process.env.LLM_PROVIDER || 'openai_compat';
        if (provider === 'openai') provider = 'openai_compat'; // 兼容旧版 localStorage 数据

        const model = process.env.LLM_MODEL || 'deepseek-chat';
        const apiKey = process.env.LLM_API_KEY;
        const baseUrl = process.env.LLM_BASE_URL;

        // Stagehand 使用 "provider/model" 作为 modelName
        let modelName;
        if (provider === 'gemini')       modelName = `google/${model}`;
        else if (provider === 'ollama')  modelName = `ollama/${model}`;
        else if (provider === 'anthropic') modelName = `anthropic/${model}`;
        else                             modelName = `deepseek/${model}`; // openai_compat → deepseek

        // 对于 openai_compat / ollama，确保 baseURL 带 /v1
        let finalBaseUrl = baseUrl;
        if ((provider === 'openai_compat' || provider === 'ollama') && finalBaseUrl) {
          finalBaseUrl = finalBaseUrl.replace(/\/+$/, '');
          if (!finalBaseUrl.endsWith('/v1')) {
            finalBaseUrl += '/v1';
          }
        }

        // model 对象：扁平结构（符合 Stagehand V3.4+ 的 ModelConfiguration 类型）
        return {
          modelName,
          apiKey: apiKey || (() => { throw new Error('LLM_API_KEY 环境变量未设置，请在应用设置中配置 API Key'); })(),
          baseURL: finalBaseUrl,
        };
      }

      // 🧠 act：用自然语言指令让 AI 直接在当前页面执行单步操作
      case 'act': {
        const { instruction } = args;
        if (!instruction) { fail('缺少参数: --instruction'); return; }

        const { Stagehand } = await import('@browserbasehq/stagehand');

        let modelConfig;
        try {
          modelConfig = buildStagehandModelConfig();
        } catch (cfgErr) {
          fail(`配置错误: ${cfgErr.message}`);
          return;
        }

        const wsUrl = await getWsUrl(cdpPort);
        const stagehand = new Stagehand({
          env: 'LOCAL',
          localBrowserLaunchOptions: { cdpUrl: wsUrl },
          model: modelConfig,
        });
        await stagehand.init();

        try {
          console.warn(`🤖 [Stagehand act] 执行指令: "${instruction}"`);
          await stagehand.act(instruction);
          await stagehand.close();
          ok({ action: 'act', instruction, message: 'Stagehand AI 执行成功' });
        } catch (actErr) {
          await stagehand.close().catch(() => {});
          let errorDetails = actErr.message;
          if (actErr.cause) errorDetails += ` | Cause: ${actErr.cause.message || actErr.cause}`;
          fail(`Stagehand act 失败: ${errorDetails}`);
        }
        return;
      }

      // 👁️ observe：用自然语言让 AI 观察当前页面有哪些可操作元素
      case 'observe': {
        const { instruction } = args;
        if (!instruction) { fail('缺少参数: --instruction'); return; }

        const { Stagehand: SH } = await import('@browserbasehq/stagehand');

        let modelConfig;
        try {
          modelConfig = buildStagehandModelConfig();
        } catch (cfgErr) {
          fail(`配置错误: ${cfgErr.message}`);
          return;
        }

        const wsUrl = await getWsUrl(cdpPort);
        const sh = new SH({
          env: 'LOCAL',
          localBrowserLaunchOptions: { cdpUrl: wsUrl },
          model: modelConfig,
        });
        await sh.init();

        try {
          console.warn(`👁️ [Stagehand observe] 观察指令: "${instruction}"`);
          const observations = await sh.observe(instruction);
          await sh.close();
          ok({ action: 'observe', instruction, observations, message: '观察完成' });
        } catch (obsErr) {
          await sh.close().catch(() => {});
          let errorDetails = obsErr.message;
          if (obsErr.cause) errorDetails += ` | Cause: ${obsErr.cause.message || obsErr.cause}`;
          fail(`Stagehand observe 失败: ${errorDetails}`);
        }
        return;
      }

      // 🚀 agent：全自主闭环 Agent 模式
      //    - 接受一整句自然语言目标（如"登录系统并下载报表"）
      //    - 由 Stagehand 原生 agent() 自主决策每一步（看页面 → 行动 → 看结果 → 纠错）
      //    - 每完成一个子步骤，向 stdout 输出 [AGENT_STEP] 格式的 JSON 行
      //    - Rust 后端读取这些日志行并触发 Tauri 事件推送到前端
      case 'agent': {
        const { instruction } = args;
        if (!instruction) { fail('缺少参数: --instruction'); return; }

        const { Stagehand: StagehandAgent } = await import('@browserbasehq/stagehand');

        let modelConfig;
        try {
          modelConfig = buildStagehandModelConfig();
        } catch (cfgErr) {
          fail(`配置错误: ${cfgErr.message}`);
          return;
        }

        const wsUrl = await getWsUrl(cdpPort);
        const stagehand = new StagehandAgent({
          env: 'LOCAL',
          localBrowserLaunchOptions: { cdpUrl: wsUrl },
          model: modelConfig,
          // onStepFinish callback 是实验性特性，必须设置以下两个标志
          experimental: true,
          disableAPI: true,
        });
        await stagehand.init();

        // 工具函数：将 Agent 的中间步骤推送到 stdout 供 Rust 捕获
        // 格式必须是 [AGENT_STEP] 开头，Rust 端只捕获这类行
        function emitAgentStep(type, description, detail) {
          const payload = {
            type,          // 'thinking' | 'action' | 'done' | 'error'
            description,   // 对用户展示的可读步骤描述
            detail: detail || null,
            timestamp: new Date().toISOString(),
          };
          // 同步输出，确保 Rust 可以逐行读取
          process.stdout.write('[AGENT_STEP]' + JSON.stringify(payload) + '\n');
        }

        try {
          console.warn(`🚀 [Stagehand agent] 开始执行目标: "${instruction}"`);
          emitAgentStep('thinking', 'AI 正在分析页面并制定执行策略...', null);

          // 创建原生 agent 实例（dom 模式：基于 DOM 感知，兼容性最好，避免截图消耗 token）
          const agent = stagehand.agent({
            mode: 'dom',
            systemPrompt: `你是一个严格、精准的浏览器自动化 Agent。
规则（必须遵守，不得妥协）：
1. 每次操作后，必须通过读取页面 DOM 或 ariaTree 验证操作是否真正生效，不能假设成功。
2. 针对下拉选择框（Select / Combobox）：
   - 许多下拉框极易因失焦（如读取 DOM 树、鼠标微移或中间决策等待）而自动折叠收起，导致下一步点击选项失败。
   - 【连贯动作防失焦 - 必胜法则】：绝对不要把“点击展开下拉框”和“点击/输入选择选项”拆分成两个独立的 act() 调用！因为每次工具调用结束后，系统都会重新读取 DOM 树，这会触发失焦导致下拉框折叠。
     你必须将它们合并在【同一个】连贯的 act() 动作描述中，让底层 Playwright 在一次无缝的执行流中连续完成，不给页面留下任何失焦机会。
     例如，你可以直接调用一次 act() 传入如下复合指令：
     - `"click the performance period dropdown and click the '2025' option immediately without any focus shift"`
     - `"click the performance period dropdown, wait 500ms, then press ArrowDown three times, then press Enter"`
     - `"click the performance period dropdown and type '2025' then press Enter immediately"`
   - 只要动作连贯合并，中间没有 DOM 读取，下拉框就绝对不会失焦收回！
3. 只有在通过验证确认所有操作都已生效后，才能调用 done 工具。
4. 如果一个操作失败或无效，尝试其他方法（如 ariaTree 定位、键盘操作、直接输入等），不要直接宣告成功。
5. 不要截图，优先使用 ariaTree 和 DOM 工具感知页面状态，节省 token。`,
          });

          // 执行：传入用户目标，并注册 onStepFinish 回调
          const result = await agent.execute({
            instruction,
            maxSteps: 50, // 最多 50 步，给予复杂多步骤交互与自愈充足的步骤额度
            // 禁用截图工具，完全依赖 DOM 感知，节省 token 且更准确
            excludeTools: ['screenshot'],
            callbacks: {
              onStepFinish: (step) => {
                // step 是 Vercel AI SDK 的 StepResult 对象
                // 提取 agent 本轮调用的工具名和参数作为步骤描述
                const toolCalls = step.toolCalls || [];
                for (const toolCall of toolCalls) {
                  const toolName = toolCall.toolName || 'action';
                  let desc = '';
                  const input = toolCall.input || {};

                  if (toolName === 'act' || toolName === 'fillForm') {
                    desc = `执行操作: ${input.instruction || input.action || JSON.stringify(input)}`;
                  } else if (toolName === 'done') {
                    desc = `任务完成: ${input.message || ''}`;
                  } else if (toolName === 'goto') {
                    desc = `导航到: ${input.url || ''}`;
                  } else if (toolName === 'think') {
                    desc = `AI 思考: ${(input.thought || '').substring(0, 100)}`;
                  } else if (toolName === 'extract') {
                    desc = `提取数据: ${input.instruction || ''}`;
                  } else if (toolName === 'scroll') {
                    desc = `滚动页面: ${input.direction || ''}`;
                  } else if (toolName === 'keys') {
                    desc = `按键: ${input.keys || ''}`;
                  } else if (toolName === 'wait') {
                    desc = `等待: ${input.ms || ''}ms`;
                  } else if (toolName === 'screenshot') {
                    desc = `截图分析当前状态`;
                  } else if (toolName === 'ariaTree') {
                    desc = `读取页面可访问性树`;
                  } else {
                    desc = `${toolName}: ${JSON.stringify(input).substring(0, 80)}`;
                  }

                  emitAgentStep(toolName === 'done' ? 'done' : 'action', desc, toolName);
                }

                // 如果本轮没有工具调用（纯文本推理步骤），输出思考状态
                if (toolCalls.length === 0 && step.text) {
                  emitAgentStep('thinking', `AI 推理: ${step.text.substring(0, 100)}`, null);
                }
              },
            },
          });

          await stagehand.close();

          // 输出最终结果
          if (result.success) {
            emitAgentStep('done', `✅ 任务成功完成: ${result.message || ''}`, null);
            ok({
              action: 'agent',
              instruction,
              success: true,
              message: result.message || 'Agent 任务成功',
              actions: result.actions || [],
            });
          } else {
            emitAgentStep('error', `❌ 任务未能完成: ${result.message || ''}`, null);
            fail(`Agent 任务失败: ${result.message || '未知原因'}`);
          }
        } catch (agentErr) {
          await stagehand.close().catch(() => {});
          let errorDetails = agentErr.message;
          if (agentErr.cause) errorDetails += ` | Cause: ${agentErr.cause.message || agentErr.cause}`;
          emitAgentStep('error', `❌ Agent 执行异常: ${errorDetails}`, null);
          fail(`Stagehand agent 执行失败: ${errorDetails}`);
        }
        return;
      }

      // ❓ 未知命令
      default:
        fail(`未知命令: ${command}。支持的命令: get_snapshot, click, type, navigate, select, wait_for, screenshot, assert, act, observe, agent`);
    }
  } catch (e) {
    fail(`执行命令 "${command}" 失败: ${e.message}`);
  } finally {
    // disconnect 而不是 close，让 Chrome 继续正常运行
    await browser.close(); // 对于 connectOverCDP，close() 实际上是 disconnect
  }
}

main();



