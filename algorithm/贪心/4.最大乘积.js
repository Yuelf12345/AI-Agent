/**
 * 
给定一个正整数 n，将其切分为至少两个正整数的和，求切分后所有整数的乘积最大是多少,
如 6 可切分为 3*3 、 2*2*2
 */
function integerBreak(n) {
    if (n <= 3) return n - 1;
    let product = 1;
    while (n > 4) {
        product *= 3;
        n -= 3;
    }
    return product * n; // 剩下 2 / 3 / 4
}
console.log(integerBreak(6)); // 9

/**
 * 思路：贪心 —— 能拆 3 就拆 3
 *
 * ① 不拆出 1：n = 1 + (n-1) 的乘积是 n-1，反而变小，纯亏
 * ② 因子不会 ≥ 5：对任意 x ≥ 5，拆成 3 + (x-3) 后
 *      3 * (x-3) = 3x - 9 > x   （x ≥ 5 时成立，2x > 9）
 *    即因子只要 ≥ 5 就还能继续拆得更大，故最优解里只会有 2 和 3
 * ③ 3 比 2 更优：3 + 3 = 6 → 9，而 2 + 2 + 2 = 6 → 8
 *    所以每出现 3 个 2 就该换成 2 个 3 → 结论：尽量多拆 3
 *
 * 按 n % 3 分类：
 *   n % 3 == 0 → 全拆 3              如 9 = 3*3*3 = 27
 *   n % 3 == 2 → 一堆 3 + 一个 2      如 8 = 3*3*2 = 18
 *   n % 3 == 1 → 少用一个 3，把 3+1 换成 2+2
 *                如 7 = 3*2*2 = 12（若硬拆 3*3*1 = 9，更小）
 *
 * 边界（必须切成至少两个数）：
 *   n = 2 → 1*1 = 1
 *   n = 3 → 1*2 = 2   （不能直接返回 3）
 *
 * 例：n = 6
 *   6 > 4 → 拿走 3，product = 3，剩 3
 *   3 不再 > 4 → 返回 3 * 3 = 9 ✅
 *   （错误做法 2*2*2 = 8）
 *
 * 验证 n=10：10>4 → 3, n=7 → 3, n=4 → 3*3*4 = 36   （3+3+2+2）
 */

/* 贪心实现：while 里不断拿走 3 */
function integerBreakGreedy(n) {
    if (n <= 3) return n - 1; // n=2→1, n=3→2
    let product = 1;
    // 剩 4 时不要再拆 3（3*1 < 2*2），所以条件是 n > 4
    while (n > 4) {
        product *= 3;
        n -= 3;
    }
    return product * n; // 剩下 2 / 3 / 4
}

/* 交叉验证（动态规划写法，非贪心）：
 */
function integerBreakDP(n) {
    const dp = Array(n + 1).fill(0);
    dp[1] = 1;
    for (let i = 2; i <= n; i++) {
        let best = 0; // 记录 i 的最大乘积
        for (let j = 1; j < i; j++) {
            // i 拆成 j、(i-j) 或 j、继续拆(i-j)，取最大值
            best = Math.max(best, Math.max(j * (i - j), j * dp[i - j]));
        }
        dp[i] = best;
    }
    return dp[n];
}
console.log(integerBreakDP(6));