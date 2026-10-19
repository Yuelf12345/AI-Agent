/**
 * 给定三根柱子，记为 A、B 和 C 。起始状态下，柱子 A 上套着 
 个圆盘，它们从上到下按照从小到大的顺序排列。我们的任务是要把这 
 个圆盘移到柱子 C 上，并保持它们的原有顺序不变。在移动圆盘的过程中，需要遵守以下规则。
    圆盘只能从一根柱子顶部拿出，从另一根柱子顶部放入。
    每次只能移动一个圆盘。
    小圆盘必须时刻位于大圆盘之上。
     |       |      |
    [|]      |      |
   [ | ]     |      |
  [  |  ]    |      |   
     A       B      C   
 */
let setp = 0
var hanota = function (A, B, C) {
    const n = A.length
    dfs(n, A, B, C)
    console.log(setp);
    return C
};
function moveBy(A, C) {
    const pan = A.pop()
    C.push(pan)
    setp++
}
function dfs(n, A, B, C) {
    if (n === 1) {
        moveBy(A, C)
        return
    }
    dfs(n - 1, A, C, B)
    moveBy(A, C)
    dfs(n - 1, B, A, C)
}
// console.log(hanota([2, 1, 0], [], []));


var hanotaLoop = function (A, B, C) {
    const n = A.length;
    const stack = [[n, A, B, C]];
    let step = 0;
    while (stack.length) {
        const [k, src, buf, tar] = stack.pop()
        if (k === 1) {
            tar.push(src.pop())
            step++
        }else{
            stack.push([k-1,buf,src,tar]) // ③ 最先压 → 最后执行
            stack.push([1,src,buf,tar])   // ② 排队而不是当场做
            stack.push([k-1,src,tar,buf]) // ① 最后压 → 最先执行
        }
    }
    return step
};
const A = [2, 1, 0]
const B = []
const C = []
console.log(hanotaLoop(A, B, C))
console.log('A:', A, 'B:', B, 'C:', C)