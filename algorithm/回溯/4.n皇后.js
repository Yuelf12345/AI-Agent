/**
 * 根据国际象棋的规则，皇后可以攻击与同处一行、一列或一条斜线上的棋子。给定n个皇后和一个n*n 大小的棋盘，寻找使得所有皇后之间无法相互攻击的摆放方案。
 */

function nQueens(n) {
    const res = [];
    const board = new Array(n).fill(0).map(() => new Array(n).fill("."));
    const cols = new Set();
    const diag1 = new Set();
    const diag2 = new Set();
    function backtrack(row) {
        if (row === n) {
            const r = board.map((r) => r.join(""));
            res.push(r);
            return;
        }
        for (let col = 0; col < n; col++) {
            if (cols.has(col) || diag1.has(row - col) || diag2.has(row + col)) {
                continue;
            }
            board[row][col] = "Q";
            cols.add(col);
            diag1.add(row - col);
            diag2.add(row + col);
            backtrack(row + 1);
            board[row][col] = ".";
            cols.delete(col);
            diag1.delete(row - col);
            diag2.delete(row + col);
        }
    }
    backtrack(0);
    return res;
}
console.log(nQueens(4));
