import type { InteractiveElement } from '../types';

/**
 * 压缩 DOM 结构为精简文本，供大模型理解（Token 优化）
 * 
 * 大模型的上下文窗口有限，如果直接把包含大量属性的 JSON 数组发给模型，
 * 一方面会浪费大量 Token 费用，另一方面会让模型产生"注意力涣散"（幻觉）。
 * 这个工具将 InteractiveElement 数组转化为类似如下的精简伪代码结构：
 * 
 * [#0] <button> "登录" | sel: "#login-btn"
 * [#1] <input> p:"请输入密码" | sel: "input[name='pwd']"
 */
export function compressDomForLlm(elements: InteractiveElement[]): string {
  if (!elements || elements.length === 0) {
    return "页面上没有找到可交互元素。";
  }

  const lines = elements.map((el) => {
    // 基础标签
    let line = `[#${el.index}] <${el.tag.toLowerCase()}>`;
    
    // 拼接文本或属性
    const traits: string[] = [];
    
    if (el.text && el.text.trim()) {
      // 截断过长的文本
      let cleanText = el.text.replace(/\s+/g, ' ').trim();
      if (cleanText.length > 30) cleanText = cleanText.substring(0, 30) + '...';
      traits.push(`"${cleanText}"`);
    }
    
    if (el.placeholder) {
      traits.push(`p:"${el.placeholder}"`);
    }
    
    if (el.type) {
      traits.push(`t:"${el.type}"`);
    }
    
    if (el.ariaLabel && !el.text) {
      traits.push(`aria:"${el.ariaLabel}"`);
    }

    if (traits.length > 0) {
      line += ` ${traits.join(' ')}`;
    }

    if (el.x !== undefined && el.y !== undefined) {
      line += ` [x:${el.x}, y:${el.y}]`;
    }

    return line;
  });

  return lines.join('\n');
}
