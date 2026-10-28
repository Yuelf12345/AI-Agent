/**
 * 背包容量应该按什么顺序更新
一个 0-1 背包只有一件物品：重量为 2，价值为 5；背包容量为 4。 每件物品最多选择一次，初始一维数组为 dp = [0, 0, 0, 0, 0]。
一位同学在处理这件物品时，按容量从 2 到 4 更新：
更新 dp[2] 后得到 5；
更新 dp[3] 后也得到 5；
更新 dp[4] 时又使用刚得到的 dp[2]，于是得到 dp[4] = 10。
dp[4] = 10 这个结果是否正确？为什么？
根据“每件物品最多选择一次”的条件，dp[4] 应为多少？
处理每件物品时，容量应从大到小还是从小到大更新？这样做避免了什么问题？
 */

/**
 * 给定等长数组 wgt 和 val，第 i 件物品的重量为正整数 wgt[i]、价值为非负整数 val[i]， 背包容量 cap 为非负整数。每件物品最多选择一次，请在总重量不超过 cap 的条件下， 求能够装入背包的最大总价值。请使用一维动态规划实现。
 */
// 一维压缩版：dp[j] 表示在当前已经处理的物品中，容量不超过 j 时的最大价值
function knapsack1D(capacity, weights, values) {
    const dp = Array(capacity + 1).fill(0)
    for(let i=0;i<weights.length;i++){
        for(let j= capacity;j>=weights[i];j--){
            dp[j] = Math.max(dp[j],dp[j-weights[i]]+values[i])
        }
    }
    return dp[capacity]
}
console.log(knapsack1D(5, [2, 4, 3], [3, 4, 5]))