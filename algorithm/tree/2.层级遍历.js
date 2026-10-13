/**
 * 给你二叉树的根节点 root ，返回其节点值的 层序遍历 。 （即逐层地，从左到右访问所有节点）。
 *  输入：root = [3,9,20,null,null,15,7]
    输出：[[3],[9,20],[15,7]]
 */

var levelOrder = function(root) {
    if(!root || !root.length) return []
    const queue = [root]
    const res = []
    while(queue.length){
        const levelLen = queue.length
        const level = []
        for(let i=0;i< levelLen; i++){
            const node = queue.shift()
            level.push(node.val)
            if(node.left)queue.push(node.left)
            if(node.right)queue.push(node.right)
        }
        res.push(level)
    }
    return res
};

console.log(levelOrder([]));
