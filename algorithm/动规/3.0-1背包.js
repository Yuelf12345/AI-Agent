/**
 * 给定n个物品，第i个物品的重量为wgt[i-1]、价值为val[i-1] ，和一个容量为cap的背包。每个物品只能选择一次，问在限定背包容量下能放入物品的最大价值。 * @param {number} capacity
 * @param {number[]} weights
 * @param {number[]} values
 * @return {number}
 */
function knapsack(capacity, weights, values) {
    const n = weights.length
    // dp[i][j]：前 i 个物品、背包容量为 j 时的最大价值
    const dp = Array.from({ length: n + 1 }, () => Array(capacity + 1).fill(0))
    for(let i = 1;i <= n;i++){
        for(let j = 0;j <= capacity;j++){
            if(weights[i-1] > j) {
                dp[i][j] = dp[i-1][j]
            }else{
                dp[i][j] = Math.max(dp[i-1][j],dp[i-1][j-weights[i-1]]+values[i-1])
            }
        }
    }
    return dp[n][capacity]
}
// console.log(knapsack(5, [2, 4, 3], [3, 4, 5]))
/**
 *    0 1 2 3 4 5 
 * 0  0 0 3 3 3 3
 * 1  0 0 3 3 4 4
 * 2  0 0 3 5 5 7
 */

// 一维压缩版：dp[j] 表示在当前已经处理的物品中，容量不超过 j 时的最大价值
function knapsack1D(capacity, weights, values) {
    // 初始没有放入任何物品，所有容量下的最大价值都是 0
    const dp = Array(capacity + 1).fill(0)

    // 依次处理每个物品，每个物品只能选择一次
    for(let i = 0;i < weights.length;i++){
        const w = weights[i], v = values[i]

        // 0-1 背包必须从大到小更新容量
        // 这样 dp[j-w] 还没有被当前物品更新，仍然是处理当前物品前的旧状态
        // 因此 dp[j-w] + v 表示：不重复使用当前物品的情况下，再放入当前物品
        for(let j = capacity;j >= w;j--){
            // 不选当前物品：保留原来的 dp[j]
            // 选当前物品：使用容量 j-w 的旧状态，加上当前物品价值 v
            dp[j] = Math.max(dp[j],dp[j-w]+v)
        }
    }
    return dp[capacity]
}
// console.log(knapsack1D(5, [2, 4, 3], [3, 4, 5]))