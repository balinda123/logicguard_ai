import type { ScenarioTemplate } from '../types';

export const defaultTemplates: ScenarioTemplate[] = [
  {
    id: 'tpl_oa_login',
    name: 'OA统一门户登录',
    category: 'login',
    description: '自动穿透企业统一SSO，绕过手机MFA（需要用户Chrome Profile保持登录）',
    targetUrl: 'https://oa.company.com/login',
    steps: [
      { order: 1, description: '导航至统一认证平台入口', action: 'navigate', selectorHint: 'https://sso.company.com/sso' },
      { order: 2, description: '检测用户登录凭证(Cookie/Token)继承状态', action: 'wait', selectorHint: 'Cookie, LocalStorage' },
      { order: 3, description: '自动点击"企业账户登录"快捷按钮', action: 'click', selectorHint: 'button#sso-quick-login' },
      { order: 4, description: '跳转回主工作台，确认欢迎信息显示', action: 'assert', selectorHint: '.welcome-message' }
    ],
    variables: [
      { name: 'loginUrl', label: '统一登录地址', type: 'text', required: true, defaultValue: 'https://sso.company.com/sso' },
      { name: 'username', label: '登录账号（参考）', type: 'text', required: false, defaultValue: 'admin@company.com' }
    ],
    tags: ['SSO', '登录', '企业门户', 'MFA绕过'],
    parameterSets: [
      {
        id: 'ps_oa_admin',
        name: '管理员角色测试',
        values: {
          loginUrl: 'https://sso.company.com/sso',
          username: 'admin@company.com'
        },
        lastRunStatus: 'success',
        lastRunAt: '2026-06-03T11:20:00.000Z'
      },
      {
        id: 'ps_oa_member',
        name: '普通员工角色测试',
        values: {
          loginUrl: 'https://sso.company.com/sso',
          username: 'user@company.com'
        }
      }
    ]
  },
  {
    id: 'tpl_form_reimbursement',
    name: '财务报销单据提交',
    category: 'form',
    description: '自动批量填写报销明细并上传发票凭证，完成流转审批提报',
    targetUrl: 'https://finance.company.com/reimbursement',
    steps: [
      { order: 1, description: '导航至新建报销单页面', action: 'navigate', selectorHint: '/bill/new' },
      { order: 2, description: '填写费用类型、部门及报销事由', action: 'type', selectorHint: 'input[name="reason"]' },
      { order: 3, description: '自动选择报销关联项目为 "2026年AI研发专项"', action: 'select', selectorHint: 'select#project' },
      { order: 4, description: '上传发票PDF附件并断言解析成功', action: 'type', selectorHint: 'input[type="file"]' },
      { order: 5, description: '点击提报，确认弹出成功提示', action: 'click', selectorHint: 'button.btn-submit' }
    ],
    variables: [
      { name: 'amount', label: '报销总金额', type: 'text', required: true, defaultValue: '1280.00' },
      { name: 'reason', label: '报销事由说明', type: 'text', required: true, defaultValue: '采购本地GPU测试算力代垫款项' }
    ],
    tags: ['财务', '表单填充', '附件上传'],
    parameterSets: [
      {
        id: 'ps_reimb_gpu',
        name: 'GPU算力代垫报销',
        values: {
          amount: '1280.00',
          reason: '采购本地GPU测试算力代垫款项'
        }
      },
      {
        id: 'ps_reimb_travel',
        name: '北京出差交通报销',
        values: {
          amount: '450.00',
          reason: '5月北京出差拜访客户打车与高铁票'
        }
      }
    ]
  },
  {
    id: 'tpl_jira_issue',
    name: 'JIRA缺陷智能提单',
    category: 'form',
    description: '将测试失败的堆栈信息 and 自动化截图直接提报到JIRA看板',
    targetUrl: 'https://jira.company.com/secure/CreateIssue',
    steps: [
      { order: 1, description: '打开新建缺陷对话框', action: 'click', selectorHint: '#create-menu' },
      { order: 2, description: '选择缺陷类型(Bug)', action: 'select', selectorHint: 'select#issuetype-field' },
      { order: 3, description: '填充缺陷标题', action: 'type', selectorHint: 'input#summary' },
      { order: 4, description: '使用Markdown填充详细缺陷复现步骤', action: 'type', selectorHint: 'textarea#description' },
      { order: 5, description: '保存缺陷并返回缺陷ID', action: 'click', selectorHint: 'input#create-issue-submit' }
    ],
    variables: [
      { name: 'project', label: '目标项目Key', type: 'text', required: true, defaultValue: 'LG' },
      { name: 'summary', label: '缺陷概要描述', type: 'text', required: true, defaultValue: '[AI自动报障] 请假申请审批节点状态未成功更新' }
    ],
    tags: ['研发协作', 'JIRA', '智能提单']
  }
];
