/**
 * 输入两个字符串s和t，返回将s转换为t所需的最少编辑步数。
你可以在一个字符串中进行三种编辑操作：插入一个字符、删除一个字符、将字符替换为任意一个字符
将 kitten 转换为 sitting 需要编辑 3 步，包括 2 次替换操作与 1 次添加操作
将 hello 转换为 algo 需要 3 步，包括 2 次替换操作和 1 次删除操作。
 */
function editDistanceDP(s, t) {
    const m = s.length
    const n = t.length
    // 把 s 的前 i 个字符 变成 t 的前 j 个字符 所需最少步数
    const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0))
    //初始化首行列
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            // 状态转移
            if (s[i - 1] == t[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1]
            } else {
                const case1 = dp[i - 1][j - 1] + 1 // 替换
                const case2 = dp[i - 1][j] + 1 // 删除
                const case3 = dp[i][j - 1] + 1 // 添加(其实就是j的删除)
                dp[i][j] = Math.min(case1, case2, case3)
            }
        }
    }
    return dp[m][n]
    console.log(dp)
}
// console.log(editDistanceDP("kitten", "sitting"))

function editDistanceDP1D(s, t) {
    const dp = Array(t.length + 1).fill(0)
    const m = s.length
    const n = t.length
    for (let j = 0; j <= n; j++) dp[j] = j
    for (let i = 1; i <= m; i++) {
        let prev = dp[0] // 保存dp[i-1][j-1]
        dp[0] = i
        for (let j = 1; j <= n; j++) {
            const temp = dp[j]
            if (s[i - 1] == t[j - 1]) {
                dp[j] = prev
            } else {
                const case1 = prev + 1 // 替换
                const case2 = dp[j] + 1 // 删除
                const case3 = dp[j - 1] + 1 // 添加
                dp[j] = Math.min(case1, case2, case3)
            }
            prev = temp
        }
    }
    return dp[n]
}
console.log(editDistanceDP1D("hello", "algo"))
