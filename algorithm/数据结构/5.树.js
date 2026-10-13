/* 二叉树节点类 */
class TreeNode {
    val; // 节点值
    left; // 左子节点指针
    right; // 右子节点指针
    height; // 节点高度（AVL 树用）
    constructor(val, left, right) {
        this.val = val === undefined ? 0 : val;
        this.left = left === undefined ? null : left;
        this.right = right === undefined ? null : right;
        // 新建叶子节点高度为 0（哨兵： null 的高度视为 -1，方便统一计算）
        this.height = 0;
    }
}
/* 初始化二叉树 */
// 初始化节点
let n1 = new TreeNode(1),
    n2 = new TreeNode(2),
    n3 = new TreeNode(3),
    n4 = new TreeNode(4),
    n5 = new TreeNode(5);
// 构建节点之间的引用（指针）
n1.left = n2;
n1.right = n3;
n2.left = n4;
n2.right = n5;
// console.log(n1);

// BFS
function BFS(root) {
    const queue = [root]
    const res = []
    while (queue.length) {
        const node = queue.shift()
        res.push(node.val)
        if (node.left) queue.push(node.left)
        if (node.right) queue.push(node.right)
    }
    return res
}
console.log(BFS(n1));

const list = []
// DFS 前 中 后
function DFS(root) {
    if (!root) return
    list.push(root.val)
    DFS(root.left)
    DFS(root.right)
}
DFS(n1)
// console.log(list);

// 二叉树数组表示
/**
 * 实现了一棵基于数组表示的二叉树，包括以下几种操作。
    给定某节点，获取它的值、左（右）子节点、父节点。
    获取前序遍历、中序遍历、后序遍历、层序遍历序列。
 */

class ArrayBinaryTree {
    constructor(arr) {
        this.tree = arr;
    }
    // 列表容量
    size() {
        return this.tree.length
    }
    // 当前索引值
    val(i) {
        if (1 < 0 || i >= this.size()) return null
        return this.tree[i]
    }
    // 左
    leftVal(i) {
        return this.val(2 * i + 1)
    }
    // 右
    rightVal(i) {
        return this.val(2 * i + 2)
    }
    // 父
    parent(i) {
        return this.val(Math.floor((i - 1) / 2))
    }
    // 广度遍历
    bfs() {
        let res = [];
        // 直接遍历数组
        for (let i = 0; i < this.size(); i++) {
            if (this.val(i) !== null) res.push(this.val(i));
        }
        return res;
    }
    // 深度
    dfs(order, i, res) {
        if (!this.val(i)) return
        if (order === 'pre') res.push(this.val(i))
        this.dfs(this.leftVal(i), res)
        if (order === 'in') res.push(this.val(i))
        this.dfs(this.rightVal(i), res)
        if (order === 'post') res.push(this.val(i))
    }

    preDfs() {
        const res = []
        this.dfs('pre', 0, res)
        return res
    }
    inDfs() {
        const res = []
        this.dfs('in', 0, res)
        return res
    }
    postDfs() {
        const res = []
        this.dfs('post', 0, res)
        return res
    }
}

// 二叉搜索树 左<根<右
const t1 = new TreeNode(1)
const t2 = new TreeNode(2)
const t3 = new TreeNode(3)
const t4 = new TreeNode(4)
const t5 = new TreeNode(5)
const t6 = new TreeNode(6)
t4.left = t2
t4.right = t6
t2.left = t1
t2.right = t3
t6.left = t5

function search(tree, num) {
    let node = tree
    while (node) {
       if(node.val === num) return node
       if(node.val < num) node = node.right
       else if(node.val > num) node = node.left
    }
    return null
}
console.log(search(t4, 3));


function insert(tree, num){
    if(!tree) return new TreeNode(num)
    let node = tree
    let pre = null
    while(node){
        if(node.val === num) return
        pre = node
        if(node.val < num) node = node.right
        else node = node.left
    }
    const newNode = new TreeNode(num)
    if(pre.val > num) pre.left = newNode
    if(pre.val < num) pre.right = newNode
}
// insert(t4,8)
// insert(t4,7)
// console.log(t4);

/**
 * 
    删除节点分3种情况
    第一种, 删除节点为叶子节点, 直接删除
    第二种, 删除节点只有左或右子树，则用左或右子树代替
    第三种，删除节点有左右子树，则用右子树最小值（或左子树最大值）代替
 */
function del(tree, num){
    if(!tree) return
    let cur = tree // 当前节点
    let pre = null // 父节点
    // 找到当前节点
    while(cur) {
        if(cur.val === num) break
        pre = cur
        if(cur.val < num) cur = cur.right
        else cur = cur.left
    }
    if (cur === null) return;
    // 第一、二种情况
    if(!cur.left || !cur.right){
       const child = cur.left || cur.right
        if(cur !== tree){
            // 如果是删的父左节点,挂左边
            if(pre.left === cur) pre.left = child
            else pre.right = child
        }else{
            tree = child
        }
    }
    // 第三种情况
    else {
        // 递归找到右节点的最小值
        const temp = cur.right
        while(temp.left){
            temp = temp.left
        }
        // 将temp移动到当前删除的节点处
        del(tree, temp.val);
        cur.val = temp.val
    }
}

// console.log('删除前',t4);
// del(t4,5)
// del(t4,6)
// del(t4,2)
// console.log('删除后',t4);

/** lodash 逃逸：null 节点高度当作 -1
 *  叶子是 0，父节点 = 孩子高度最大值 + 1
 */
function height(node) {
    return node ? node.height : -1
}

// 更新节点高度：重新依赖左右孩子的高差
function updateHeight(node) {
    node.height = Math.max(height(node.left), height(node.right)) + 1
}

// 递归把整棵树的高度刷成真实值
function refreshAll(node) {
  if (!node) return -1
  node.height = Math.max(refreshAll(node.left), refreshAll(node.right)) + 1
  return node.height
}

// 右旋转
function rightRotate(node){
    const child = node.left
    const grandChild = child.right
    child.right = node
    node.left = grandChild
    // 更新节点高度：先 node 后 child，因为 child 的高度依赖 node
    updateHeight(node)
    updateHeight(child)
    return child
}

// 左旋转（和右旋完全对称）
function leftRotate(node){
    const child = node.right
    const grandChild = child.left
    child.left = node
    node.right = grandChild
    // 更新节点高度：先 node 后 child
    updateHeight(node)
    updateHeight(child)
    return child
}

const a0 = new TreeNode(0)
const a1 = new TreeNode(1)
const a2 = new TreeNode(2)
const a3 = new TreeNode(3)
const a4 = new TreeNode(4)
const a5 = new TreeNode(5)
const a6 = new TreeNode(6)
a4.left = a3
a3.left = a0
// a4.right = a5
refreshAll(a4);
console.log('AVL',a4);
const res = rightRotate(a4)
console.log('right',res);

/* 执行旋转操作，使该子树重新恢复平衡 */
function rotate(node) {
    
}