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

function knapsack1D(capacity, weights, values) {
    const dp = Array(capacity + 1).fill(0)
    for(let i = 0;i < weights.length;i++){
        const w = weights[i], v = values[i]
        for(let j = capacity;j >= w;j--){
            dp[j] = Math.max(dp[j],dp[j-w]+v)
        }
    }
    return dp[capacity]
}
// console.log(knapsack1D(5, [2, 4, 3], [3, 4, 5]))