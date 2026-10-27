/**
 * 给定一个n*m的二维网格 grid ，网格中的每个单元格包含一个非负整数，表示该单元格的代价。机器人以左上角单元格为起始点，每次只能向下或者向右移动一步，直至到达右下角单元格。请返回从左上角到右下角的最小路径和。
 */
function minPathSumDP(grid) {
    const m = grid.length; // 行
    const n = grid[0].length; // 列
    const dp = new Array(m).fill(0).map(() => new Array(n).fill(0));
    dp[0][0] = grid[0][0];
    for (let i = 1; i < m; i++) {
        dp[i][0] = dp[i - 1][0] + grid[i][0];
    }
    for (let j = 1; j < n; j++) {
        dp[0][j] = dp[0][j - 1] + grid[0][j];
    }
    for (let i = 1; i < m; i++) {
        for (let j = 1; j < n; j++) {
            dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j];
        }
    }
    console.log(dp);
    return dp[m - 1][n - 1];
}
console.log(
    minPathSumDP([
        [1, 3, 1,5],
        [2, 2, 4,2],
        [5, 3, 2, 1],
        [4, 3, 5, 2],
    ]),
); // 13

// 空间优化
function minPathSumDPOptimize(grid) {
    const m = grid.length; // 行
    const n = grid[0].length; // 列
    const dp = new Array(n).fill(0);
    dp[0] = grid[0][0];
    for (let j = 1; j < n; j++) {
        dp[j] = dp[j - 1] + grid[0][j];

    }
    console.log(dp);
    for (let i = 1; i < m; i++) {
        dp[0] += grid[i][0]; // 更新第一列 左边
        for (let j = 1; j < n; j++) {
            dp[j] = Math.min(dp[j], dp[j - 1]) + grid[i][j]; // 对比当前(上边)和左边大小
        }
    }
    return dp[n - 1];
}
console.log(
    minPathSumDPOptimize([
        [1, 3, 1,5],
        [2, 2, 4,2],
        [5, 3, 2, 1],
        [4, 3, 5, 2],
    ]),
); // 13
