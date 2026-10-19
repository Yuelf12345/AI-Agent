/**
 * 给定一棵二叉树的前序遍历 preorder 和中序遍历 inorder ，请从中构建二叉树，返回二叉树的根节点。假设二叉树中没有值重复的节点（如图 12-5 所示）。
 * preorder: [3,9,2,1,7]  [3|9|2,1,7] [2,1,7]
 * inorder: [9,3,1,2,7]   [9|3|1,2,7] [1,2,7]
 *   3
 *  9 2
 *   1 7
 *       1
 *     2   3
 *    4 5 6 7
 * preorder [1,2,4,5,3,6,7] [1|2,4,5|3,6,7] [1|[2|4|5]|[3|6|7]]
 * inorder  [4,2,5,1,6,3,7] [4,2,5|1|6,3,7] [[4|2|5]|1|[3|6|7]] 
 */
/* 构建二叉树：分治 */
class TreeNode {
    constructor(i, left, right) {
        this.val = i;
        this.left = left;
        this.right = right;
    }
}

/* 构建二叉树 */
function dfs(preorder, inorderMap, i, left, right) {
    if (left > right) return null;
    const root = new TreeNode(preorder[i])
    const m = inorderMap.get(preorder[i]);
    /**
     * 左子树根紧跟当前根 i+1
     */
    root.left = dfs(preorder, inorderMap, i + 1, left, m - 1)
    /**
     * 位置从 left 到 m-1，共 (m-1) - left + 1 = m - left 格。这就是左子树的大小。
     * 右子树根跳过当前根 + 整个左子树
     * i + m - left + 1
     */
    root.right = dfs(preorder, inorderMap, i + m - left + 1, m + 1, right)
    return root
}
function buildTree(preorder, inorder) {
    // 构建中序列映射表
    const inorderMap = new Map();
    for (let i = 0; i < inorder.length; i++) {
        inorderMap.set(inorder[i], i);
    }
    return dfs(preorder, inorderMap, 0, 0, inorder.length - 1)
}

// console.log(buildTree([1, 2, 4, 5, 3, 6, 7], [4, 2, 5, 1, 6, 3, 7]));
function buildTreeLoop(preorder, inorder) {
    const stack = []
    const inorderMap = new Map();
    for (let i = 0; i < inorder.length; i++) {
        inorderMap.set(inorder[i], i);
    }
    console.log(inorderMap);

    const root = new TreeNode(preorder[0])
    stack.push(root)
    for (let i = 1; i < preorder.length; i++) {
        const currIndex = inorderMap.get(preorder[i]) // 当前节点在中序遍历的索引
        let node = stack[stack.length - 1];  // 栈顶节点
        let topIndex = inorderMap.get(node.val) // 栈顶节点在中序遍历的索引
        /**
         * 对比栈顶节点和当前节点 的索引
         * 因为中序遍历里 左<根<右
         * 当前 < 栈顶 说明当前节点是左节点
         */
        if (currIndex < topIndex) { 
            node.left = new TreeNode(preorder[i])
            stack.push(node.left)
        } else {
            /** 第 3 轮 cur = 5，位置 2。此时栈是 [1(位置3), 2(位置1), 4(位置0)]：
             *  位置:    0     1     2     3     4     5     6
                inorder:[ 4 ] [ 2 ] [ 5 ] [ 1 ] [ 6 ] [ 3 ] [ 7 ]
                        │     │     ↑     │
                        │     │    cur    │
                        │     │  (现在处理)│
                        在栈里  在栈里      在栈里
                        
                栈:     [ 1(位置3) ,  2(位置1) ,  4(位置0) ]
                            ↑            ↑           ↑
                        在cur右边     在cur左边    在cur左边

                5在1的左边说明 5 是1的左子树部分, 5在4的右边说明 5是4的右子树部分, 5在2的右边说明5是2的右子树部分, 但是4是2的左子树, 如果5在4上只能是2的左节点,与5为2的右子树部分不成立,
                “4 是 2 的左子树，如果 5 挂在 4 上，5 就落进了 2 的左子树，和‘5 在 2 的右边’矛盾。”
             */
            while (stack.length && inorderVal > inorderMap.get(stack[stack.length - 1].val)) {
                node = stack.pop()
            }
            node.right = new TreeNode(preorder[i])
            stack.push(node.right)
        }
        // console.log('第' + i + '轮 preorder[i]:', preorder[i], 'inorderVal:', inorderVal, 'node:', node.val + '(' + inorderMap.get(node.val) + ')', inorderMap.get(node.val), '<', inorderVal, stack);
    }
    return root
}
console.log(buildTreeLoop([1, 2, 4, 5, 3, 6, 7], [4, 2, 5, 1, 6, 3, 7]));