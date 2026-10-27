/**
 * 给定一个共有n阶的楼梯，你每步可以上1阶或者2阶，请问有多少种方案可以爬到楼顶？
 */
function climbStairs(n) {
   if (n <= 2) return n;
   return climbStairs(n - 1) + climbStairs(n - 2);
}
console.log(climbStairs(4)); // 5

/**
 * 给定一个楼梯，你每步可以上1阶或者2阶，每一阶楼梯上都贴有一个非负整数，表示你在该台阶所需要付出的代价。给定一个非负整数数组 cost，其中 
cost[i] 表示在第i个台阶需要付出的代价,0为地面（起始点）。请计算最少需要付出多少代价才能到达顶部？
 */

function minCostClimbingStairs(cost) {
   if (cost.length === 0) return 0;
   if (cost.length === 1) return cost[0];
   if (cost.length === 2) return Math.min(cost[0], cost[1]);
   let dp = new Array(cost.length);
   dp[0] = cost[0];
   dp[1] = cost[1];
   for (let i = 2; i < cost.length; i++) {
      dp[i] = Math.min(dp[i - 1], dp[i - 2]) + cost[i];
   }
   return Math.min(dp[cost.length - 1], dp[cost.length - 2]);
}
console.log(minCostClimbingStairs([10, 15, 20])); // 15

/**
 * 给定一个共有 n阶的楼梯，你每步可以上 1阶或者 2阶，但不能连续两轮跳1阶，请问有多少种方案可以爬到楼顶？
 * 变体思路：比 climbStairs 多一个状态维度——上一步跳的是 1 还是 2
 */
/* 带约束爬楼梯：动态规划 */
function climbingStairsConstraintDP(n) {
    if (n === 1 || n === 2) {
        return 1;
    }
    // 初始化 dp 表，用于存储子问题的解
    const dp = Array.from(new Array(n + 1), () => new Array(3));
    // 初始状态：预设最小子问题的解
    dp[1][1] = 1;
    dp[1][2] = 0;
    dp[2][1] = 0;
    dp[2][2] = 1;
    // 状态转移：从较小子问题逐步求解较大子问题
    for (let i = 3; i <= n; i++) {
        dp[i][1] = dp[i - 1][2];
        dp[i][2] = dp[i - 2][1] + dp[i - 2][2];
    }
    return dp[n][1] + dp[n][2];
}
console.log(climbingStairsConstraintDP(4)); // 2（2+2 和 1+2+1）

// 暴力回溯验证：枚举所有不含连续 1 的走法
function noOnesBacktrack(n) {
   const paths = [];
   function backtrack(sum, path, lastIsOne) {
      if (sum === n) {
         paths.push(path.join('+'));
         return;
      }
      if (sum > n) return;
      if (!lastIsOne) backtrack(sum + 1, [...path, 1], true); // 上一步不是 1 才能跳 1
      backtrack(sum + 2, [...path, 2], false);                // 跳 2 没限制
   }
   backtrack(0, [], false);
   return paths;
}
console.log(noOnesBacktrack(4)); // [ '2+2', '1+2+1' ]