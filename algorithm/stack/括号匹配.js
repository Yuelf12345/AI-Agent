/**
 *  给定一个只包含 ()、[]、{} 这三类括号的字符串 s，请使用栈判断它是否合法。
    合法序列须同时满足：每个右括号都必须与最近一个尚未配对的左括号类型匹配， 并且遍历结束后没有未配对的左括号。返回布尔值表示判断结果。
 */

function isValid(s) {
    const map = {
        ')': '(',
        ']': '[',
        '}': '{'
    }
    const stack = []
    for (let i = 0; i < s.length; i++) {
        if (stack.length > 0 && stack[0] === map[s[i]]) {
            stack.shift()
        }
        else{
            stack.unshift(s[i])
        }
    }
    console.log(stack);
    return stack.length === 0
}

console.log(isValid("()[]{}"));
console.log(isValid("([])}"));
