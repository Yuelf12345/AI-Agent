/**
 * 给定一棵二叉树，搜索并记录所有值为7的节点，请返回节点列表。
 */
class TreeNode {
    constructor(val = 0, left = null, right = null) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
}
const t1 = new TreeNode(1)
const t2 = new TreeNode(7)
const t3 = new TreeNode(3)
const t4 = new TreeNode(4)
const t5 = new TreeNode(5)
const t6 = new TreeNode(6)
const t7 = new TreeNode(7)
t1.left = t2; t1.right = t3
t2.left = t4; t2.right = t5; t3.left = t6; t3.right = t7
console.log(t1);
function preOrder(root, target) {
    const res = []
    const dfs = (node) => {
        if (!node) return
        if (node.val === target) res.push(node)
        dfs(node.left)
        dfs(node.right)
    }
    dfs(root)
    return res
}
// console.log(preOrder(t1, 7));

/**
 * 回溯
 * 在二叉树中搜索所有值为7的节点，请返回根节点到这些节点的路径
 */
function path(tree, target) {
    const res = []
    const dfs = (node, path) => {
        if (!node) return
        path.push(node.val)
        if (node.val === target) res.push([...path])
        dfs(node.left, path)
        dfs(node.right, path)
        path.pop()
    }
    dfs(tree, [])
    return res
}
// console.log(path(t1, 7));

/**
 * 剪枝
 * 在二叉树中搜索所有值为7的节点，请返回根节点到这些节点的路径，并要求路径中不包含值为3的节点。
 */

function pathCut(tree, target, cutVal) {
    const res = []
    const dfs = (node, path) => {
        if(!node || node.val === cutVal) return
        path.push(node.val)
        if(node.val === target) res.push([...path])
        dfs(node.left,[...path])
        dfs(node.right, [...path])
        path.pop()
    }
    dfs(tree, [])
    return res
}
console.log(pathCut(t1, 7, 3));


/* 判断当前状态是否为解 */
function isSolution(state) {
    return state && state[state.length - 1]?.val === 7;
}
/* 记录解 */
function recordSolution(state, res) {
    res.push([...state]);
}
/* 判断在当前状态下，该选择是否合法 */
function isValid(state, choice) {
    return choice !== null && choice.val !== 3;
}
/* 更新状态 */
function makeChoice(state, choice) {
    state.push(choice);
}
/* 恢复状态 */
function undoChoice(state) {
    state.pop();
}
/* 回溯算法：例题三 */
function backtrack(state, choices, res) {
    // 检查是否为解
    if (isSolution(state)) {
        // 记录解
        recordSolution(state, res);
    }
    // 遍历所有选择
    for (const choice of choices) {
        // 剪枝：检查选择是否合法
        if (isValid(state, choice)) {
            // 尝试：做出选择，更新状态
            makeChoice(state, choice);
            // 进行下一轮选择
            backtrack(state, [choice.left, choice.right], res);
            // 回退：撤销选择，恢复到之前的状态
            undoChoice(state);
        }
    }
    return res;
}
console.log(backtrack([], [t1], []));
