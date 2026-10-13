/**
 * 给定一个二叉搜索树的根节点 root ，和一个整数 k ，请你设计一个算法查找其中第 k 小的元素（k 从 1 开始计数）。
 *  输入：root = [3,1,4,null,2], k = 1 [1,2,3,4]
    输出：1
    输入：root = [5,3,6,2,4,null,null,1], k = 3 [1,2,3,4,5,6]
    输出：3
 */

// 思路：BST 的中序遍历（左 → 根 → 右）结果就是升序序列
// 所以"第 k 小" = 中序遍历的第 k 个元素
// 遍历时每访问一个节点就 k--，k 减到 0 时当前节点就是答案（可提前剪枝退出）

function kthSmallest(root, k) {
    let count = 0;
    let res = null
    const inorder = (node) =>{
        if(!node || res !== null) return
        inorder(node.left)
        count ++
        if(count === k) res = node.val
        inorder(node.right)
    }
    inorder(root)
    return res
}

// ---------- 测试 ----------

/* 构建测试树 1：root = [3,1,4,null,2]（数组表示按层填充）
 *        3
 *      /   \
 *     1     4
 *      \
 *       2
 */
function TreeNode(val) {
    this.val = val
    this.left = null
    this.right = null
}

const m_root = new TreeNode(3)
const m_left = new TreeNode(1)
const m_right = new TreeNode(4)
m_root.left = m_left
m_root.right = m_right
m_left.right = new TreeNode(2)

console.log(kthSmallest(m_root, 1)) // 输出: 1
console.log(kthSmallest(m_root, 2)) // 输出: 2
console.log(kthSmallest(m_root, 3)) // 输出: 3
console.log(kthSmallest(m_root, 4)) // 输出: 4

/* 构建测试树 2：root = [5,3,6,2,4,null,null,1]
 *          5
 *        /   \
 *       3     6
 *      / \
 *     2   4
 *    /
 *   1
 */
const m2 = new TreeNode(5)
const n3 = new TreeNode(3)
const n6 = new TreeNode(6)
const n2 = new TreeNode(2)
const n4 = new TreeNode(4)
const n1 = new TreeNode(1)
m2.left = n3
m2.right = n6
n3.left = n2
n3.right = n4
n2.left = n1

console.log(kthSmallest(m2, 3)) // 输出: 3
