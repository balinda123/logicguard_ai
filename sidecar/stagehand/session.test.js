'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createSession } = require('./session');

function requirementStagehand(initialUrl, navigatedUrl, bodyText = '需求正文') {
  let currentUrl = initialUrl;
  const page = {
    url: () => currentUrl,
    title: async () => '需求文档',
    goto: async requestedUrl => {
      currentUrl = navigatedUrl || requestedUrl;
    },
    waitForTimeout: async () => {},
    evaluate: async (callback, argument) => {
      if (callback.length === 0) return 100;
      const previousDocument = global.document;
      global.document = {
        title: '需求文档',
        body: { innerText: bodyText },
        querySelectorAll: () => [],
        querySelector: () => null,
      };
      try {
        return callback(argument);
      } finally {
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
      }
    },
  };
  return {
    context: { awaitActivePage: async () => page },
    close: async () => {},
  };
}

test('需求抓取忽略受控浏览器中其他系统的残留页面', async () => {
  const stagehand = requirementStagehand('https://onboardingtest.example/legacy');
  const session = createSession({ stagehand });

  const result = await session.captureRequirement({
    url: 'https://docs.example/prd',
    keyword: '',
    allowedOrigins: ['https://docs.example'],
  });

  assert.equal(result.url, 'https://docs.example/prd');
  assert.equal(result.content, '需求正文');
});

test('需求抓取仍拦截导航后的跨域重定向', async () => {
  const stagehand = requirementStagehand('about:blank', 'https://other.example/login');
  const session = createSession({ stagehand });

  await assert.rejects(
    session.captureRequirement({
      url: 'https://docs.example/prd',
      keyword: '',
      allowedOrigins: ['https://docs.example'],
    }),
    error => error?.code === 'ORIGIN_NOT_ALLOWED'
      && error.message === 'ORIGIN_NOT_ALLOWED: https://other.example',
  );
});

test('关键词全部未匹配时回退页面正文而不是返回空内容', async () => {
  const stagehand = requirementStagehand('about:blank', undefined, '产品背景\n\n课程推荐规则');
  const session = createSession({ stagehand });

  const result = await session.captureRequirement({
    url: 'https://docs.example/prd',
    keyword: '精品课后台维护；猜你喜欢刷新',
    allowedOrigins: ['https://docs.example'],
  });

  assert.equal(result.content, '产品背景\n\n课程推荐规则');
  assert.equal(result.usedFullTextFallback, true);
  assert.deepEqual(result.matchedKeywords, []);
  assert.deepEqual(result.unmatchedKeywords, ['精品课后台维护', '猜你喜欢刷新']);
});

test('非 AI 模式可用零 Token 可访问性文本匹配在线文档标题', async () => {
  const stagehand = requirementStagehand('about:blank', undefined, 'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm');
  const page = await stagehand.context.awaitActivePage();
  let snapshotOptions;
  let snapshotCalls = 0;
  let activeSection = '';
  page.locator = selector => ({
    count: async () => 1,
    first: () => ({
      click: async () => { activeSection = selector.includes('3.1') ? '3.1' : '3.2'; },
    }),
  });
  page.snapshot = async options => {
    snapshotOptions = options;
    snapshotCalls += 1;
    return {
      formattedTree: snapshotCalls === 1
        ? '[1-1] document: 在线文档正在加载'
        : activeSection === '3.1'
        ? [
          '[1-1] document: 人周一课 2026 年更新-产品需求文档',
          '  [1-2] StaticText: 3.1 首页-课程推荐优化',
          '  [1-3] StaticText: 3.2 关键字搜索',
          '  [1-4] StaticText: 3.1首页-课程推荐优化',
          '  [1-5] StaticText: 首页主题推荐增加精品课标记并支持刷新。',
        ].join('\n')
        : activeSection === '3.2'
        ? [
          '[1-1] document: 人周一课 2026 年更新-产品需求文档',
          '  [1-2] StaticText: 3.1 首页-课程推荐优化',
          '  [1-3] StaticText: 3.2 关键字搜索',
          '  [1-4] StaticText: 3.2关键字搜索',
          '  [1-5] StaticText: 支持按课程标题和分类关键字查询。',
        ].join('\n')
        : [
        '[1-1] document: 人周一课 2026 年更新-产品需求文档',
        '  [1-2] heading: 3.1 首页-课程推荐优化',
        '  [1-3] heading: 3.2 关键字搜索',
      ].join('\n'),
    };
  };
  const session = createSession({ stagehand });

  const result = await session.captureRequirement({
    url: 'https://docs.example/prd',
    keyword: '3.1 首页-课程推荐优化；3.2 关键字搜索',
    aiMatch: false,
    allowedOrigins: ['https://docs.example'],
  });

  assert.equal(result.usedAiMatch, undefined);
  assert.equal(result.usedAccessibilityFallback, true);
  assert.equal(result.usedFullTextFallback, false);
  assert.deepEqual(result.matchedKeywords, ['3.1 首页-课程推荐优化', '3.2 关键字搜索']);
  assert.match(result.content, /首页主题推荐增加精品课标记/);
  assert.match(result.content, /支持按课程标题和分类关键字查询/);
  assert.equal(snapshotCalls, 4);
  assert.deepEqual(snapshotOptions, { includeIframes: true });
});

test('AI 语义匹配只能使用读取和滚动工具', async () => {
  const stagehand = requirementStagehand('about:blank');
  let agentConfig;
  let executeOptions;
  stagehand.agent = config => {
    agentConfig = config;
    return {
      execute: async options => {
        executeOptions = options;
        return {
          success: true,
          output: {
            content: '3.1 首页课程推荐\n\n刷新后更新推荐结果',
            matchedKeywords: ['猜你喜欢刷新'],
            unmatchedKeywords: [],
          },
        };
      },
    };
  };
  const session = createSession({ stagehand });

  const result = await session.captureRequirement({
    url: 'https://docs.example/prd',
    keyword: '猜你喜欢刷新',
    aiMatch: true,
    allowedOrigins: ['https://docs.example'],
  });

  assert.equal(agentConfig.mode, 'hybrid');
  assert.equal(result.usedAiMatch, true);
  assert.equal(result.aiMatchMethod, 'vision');
  assert.equal(result.content, '3.1 首页课程推荐\n\n刷新后更新推荐结果');
  assert.deepEqual(result.matchedKeywords, ['猜你喜欢刷新']);
  assert.deepEqual(executeOptions.excludeTools, [
    'act', 'fillForm', 'goto', 'keys', 'navback', 'search',
    'click', 'type', 'dragAndDrop', 'clickAndHold', 'fillFormVision',
  ]);
  assert.match(executeOptions.instruction, /Semantic relevance is enough/);
});

test('AI 语义匹配优先使用单次可访问性提取', async () => {
  const stagehand = requirementStagehand('about:blank');
  let extractOptions;
  stagehand.extract = async (_instruction, _schema, options) => {
    extractOptions = options;
    return {
      content: '3.1 首页课程推荐\n\n刷新后更新推荐结果',
      matchedKeywords: ['猜你喜欢刷新'],
      unmatchedKeywords: [],
    };
  };
  stagehand.agent = () => { throw new Error('不应启动视觉 Agent'); };
  const session = createSession({ stagehand });

  const result = await session.captureRequirement({
    url: 'https://docs.example/prd',
    keyword: '猜你喜欢刷新',
    aiMatch: true,
    allowedOrigins: ['https://docs.example'],
  });

  assert.equal(extractOptions.page.url(), 'https://docs.example/prd');
  assert.equal(extractOptions.timeout, 90000);
  assert.equal(result.aiMatchMethod, 'accessibility');
  assert.equal(result.content, '3.1 首页课程推荐\n\n刷新后更新推荐结果');
});

test('AI 两种提取方式都失败时返回可诊断原因', async () => {
  const stagehand = requirementStagehand('about:blank');
  stagehand.extract = async () => { throw new Error('structured output unsupported'); };
  stagehand.agent = () => ({
    execute: async () => ({ success: false, message: 'tool calls unsupported' }),
  });
  const session = createSession({ stagehand });

  await assert.rejects(
    session.captureRequirement({
      url: 'https://docs.example/prd',
      keyword: '猜你喜欢刷新',
      aiMatch: true,
      allowedOrigins: ['https://docs.example'],
    }),
    error => error?.code === 'AI_REQUIREMENT_EXTRACTION_FAILED'
      && /structured output unsupported/.test(error.message)
      && /tool calls unsupported/.test(error.message),
  );
});
