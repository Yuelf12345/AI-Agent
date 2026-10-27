/**
 * 给定n个物品，第i个物品的为wgt[i-1]、价值为val[i-1]，和一个容量为capacity的背包。每个物品可以重复选取，问在限定背包容量下能放入物品的最大价值。
* @param {number} capacity
* @param {number[]} weights
* @param {number[]} values
* @return {number}
*/
function completeKnapsack(capacity, weights, values) {
    const dp = Array(weights.length + 1)
        .fill(0).map(() => Array(capacity + 1).fill(0))
    for (let i = 1; i <= weights.length; i++) {
        for (let j = 0; j <= capacity; j++) {
            if (weights[i - 1] > j) {
                dp[i][j] = dp[i - 1][j]
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - weights[i - 1]] + values[i - 1])
            }
        }
    }
    return dp[weights.length][capacity]
}
// console.log(completeKnapsack(10, [2, 3, 4, 5], [3, 4, 5, 6]))

function completeKnapsack1D(capacity, weights, values) {
    const dp = Array(capacity + 1).fill(0)
    for (let i = 1; i <= weights.length; i++) {
        const w = weights[i - 1], v = values[i - 1]
        for (let j = w; j <= capacity; j++) {
            dp[j] = Math.max(dp[j], dp[j - w] + v)
        }
    }
    return dp[capacity]
}
// console.log(completeKnapsack1D(10, [2, 3, 4, 5], [3, 4, 5, 6]))

/**
 * 给定n种硬币，第i种硬币的面值为coins[i]，目标金额为amount
 ，每种硬币可以重复选取，问能够凑出目标金额的最少硬币数量。如果无法凑出目标金额，则返回 -1
* @param {number} amount
* @param {number[]} coins
* @return {number}
*/
function coinChange(coins, amount) {
    const dp = Array(coins.length + 1).fill(0).map(() => Array(amount + 1).fill(0))
    for (let j = 1; j <= amount; j++) {
        dp[0][j] = Infinity
    }
    for (let i = 1; i <= coins.length; i++) {
        for (let j = 0; j <= amount; j++) {
            if (coins[i - 1] > j) {
                dp[i][j] = dp[i - 1][j]
            } else {
                dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - coins[i - 1]] + 1)
            }
        }
    }
    return dp[coins.length][amount] === Infinity ? -1 : dp[coins.length][amount]
}
console.log(coinChange([1, 3, 5], 9)) // 5+3+1

function coinChange1D(coins, amount) {
    const dp = Array(amount + 1).fill(Infinity)
    dp[0] = 0
    for (let i = 1; i <= coins.length; i++) {
        const coin = coins[i - 1]
        for (let j = coin; j <= amount; j++) {
            dp[j] = Math.min(dp[j], dp[j - coin] + 1)
        }
    }
    return dp[amount] === Infinity ? -1 : dp[amount]
}
console.log(coinChange1D([1, 3, 5], 9)) // 5+3+1

/** 
 * 硬币组合数量
 */
function coinChangeCount(coins, amount) {
    
}
