/**
 * 给定n种硬币，第i种硬币的面值为 
 ，目标金额为coins[i]
 ，每种硬币可以重复选取，问能够凑出目标金额amount的最少硬币数量。如果无法凑出目标金额，则返回-1
 * @param {number[]} coins
 * @param {number} amount
 * @return {number}
 */
function coinChange(coins, amount) {
    const dp = Array(coins.length + 1).fill(0).map(() => Array(amount + 1).fill(0))
    // 初始化第一行 用无限多的硬币0可以凑 1,2,3...
    for(let j=1;j<=amount;j++){
        dp[0][j] = Infinity
    }
    for(let i=1;i<=coins.length;i++){
        for(let j=0;j<=amount;j++){
            if(coins[i-1] > j){
                dp[i][j] = dp[i-1][j]
            }else{
                dp[i][j] = Math.min(dp[i-1][j],dp[i][j-coins[i-1]]+1)
            }
        }
    }
    return dp[coins.length][amount] === Infinity ? -1 : dp[coins.length][amount]
    console.log(dp)
}
// console.log(coinChange([1, 3, 5], 9)) // 5,3,1 = 3
/**
 * (n*m)dp表示前n种硬币构成金额m的最小数量, 如 dp[2][3]表示在[1,3]里构成 3 的最小数量
 * 状态转移方程
 * i比j大 如 面值10 > 金额 9 只能选[i-1]种凑j
 *     dp[i][j] = dp[i-1][j]
 * i比j大 如 面值5 < 金额 9
 *     比较用[i-1]凑j, 和选当前i(硬币数+1)凑剩下的j-coins[i]  
 *     dp[i][j] = Math.min(dp[i-1][j],dp[i][j-coins[i]]+1)
 *   0 1 2 3 4 5 6 7 8 9
 * 0
 * 1
 * 2      (i,j)
 * 3 
 */

// 贪心实现
function coinChangeGreedy(coins, amount) {
    let count = 0;
    let surplus = amount;
    while(surplus>0){
        for(let i=coins.length-1;i>=0;i--){
            if(coins[i] <= surplus){
                surplus -= coins[i];
                count++;
            }
        }
        if(coins[0] < surplus) return -1 // 无解
    }
    return count === 0 ? -1 : count
}
console.log(coinChangeGreedy([1, 3, 5], 9)) // 5,3,1 = 3

/* 零钱兑换：贪心 */
function coinChangeGreedy(coins, amt) {
    // 假设 coins 数组有序
    let i = coins.length - 1;
    let count = 0;
    // 循环进行贪心选择，直到无剩余金额
    while (amt > 0) {
        // 找到小于且最接近剩余金额的硬币
        while (i > 0 && coins[i] > amt) {
            i--;
        }
        // 选择 coins[i]
        amt -= coins[i];
        count++;
    }
    // 若未找到可行方案，则返回 -1
    return amt === 0 ? count : -1;
}