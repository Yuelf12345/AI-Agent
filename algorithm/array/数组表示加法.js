/**
 * 数组表示的大整数加一
    数组 digits 从左到右保存一个非负整数的各位数字，例如 [3, 0, 8] 表示 308。 数字 0 用 [0] 表示；其他输入的第一位均不为 0。
    请模拟一次十进制竖式加法，将这个整数增加 1，并把结果仍按相同的数组形式返回。 可以直接修改 digits；若最前面产生新的进位，可以返回一个更长的数组。
 */

/**
 * 思路：从最低位开始，模拟竖式加法。
 * 加 1 的情况只有两种：
 *  1. 末位数字 < 9：直接 +1，无需进位，立即返回。
 *  2. 末位数字 == 9：该位变 0，向前进位（相当于让前一位继续"加一"）。
 * 若所有位都是 9（如 [9,9,9]），循环结束后仍未返回，说明产生新进位，
 * 返回首位为 1、其余为 0 的更长数组：[1,0,0,0]。
 *
 * 时间复杂度：O(n)   空间复杂度：O(1)（进位情况除外）
 * @param {number[]} digits
 * @return {number[]}
 */
function plusOne(digits) {
    for (let i = digits.length - 1; i >= 0; i--) {
        if (digits[i] < 9) {
            digits[i]++;
            return digits;
        }
        digits[i] = 0;
    }
    return [1, ...digits];
}

function padZero(digits, targetLen){
    if (digits.length >= targetLen) {
        return [...digits];
    }
    return [...new Array(targetLen - digits.length).fill(0), ...digits];
}

function add(digits1, digits2) {
    const maxlen = Math.max(digits1.length, digits2.length);
    d1 = padZero(digits1, maxlen);
    d2 = padZero(digits2, maxlen);
    const res = []
    let carry = 0;
    for(let i = maxlen - 1; i >= 0; i--){
        res[i] = (d1[i] + d2[i] + carry) % 10;
        carry = Math.floor((d1[i] + d2[i] + carry) / 10);
    }
    return carry ? [1, ...res] : res
}
console.log(add([1, 2, 3],[2,9]));

