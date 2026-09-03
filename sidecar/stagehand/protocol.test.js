'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseRequest } = require('./protocol');

test('需求抓取协议显式校验 AI 匹配开关', () => {
  const request = parseRequest(JSON.stringify({
    id: 'capture-ai',
    command: 'capture_requirement',
    url: 'https://docs.example/prd',
    keyword: '课程推荐',
    aiMatch: true,
    allowedOrigins: ['https://docs.example'],
  }));

  assert.equal(request.aiMatch, true);
  assert.throws(
    () => parseRequest(JSON.stringify({
      id: 'capture-invalid',
      command: 'capture_requirement',
      url: 'https://docs.example/prd',
      aiMatch: 'yes',
      allowedOrigins: ['https://docs.example'],
    })),
    /INVALID_AI_MATCH/,
  );
});

test('需求抓取协议保留多条长关键词', () => {
  const keyword = '首页推荐；'.repeat(80);
  const request = parseRequest(JSON.stringify({
    id: 'capture-keywords',
    command: 'capture_requirement',
    url: 'https://docs.example/prd',
    keyword,
    aiMatch: false,
    allowedOrigins: ['https://docs.example'],
  }));

  assert.equal(request.keyword, keyword);
  assert.equal(request.aiMatch, false);
});
