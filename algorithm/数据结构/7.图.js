/**
 * 图 - 重点回顾
 *
 * 1. 定义：图由顶点和边组成，可以表示为一组顶点 + 一组边的集合
 *    相较于线性关系（链表）、分治关系（树），网络关系（图）自由度更高，因而更复杂
 *    有向图的边有方向性；连通图中任意顶点均可达；有权图的每条边都带权重
 *
 * 2. 两种表示方式：
 *    - 邻接矩阵：n×n 二维数组，M[i][j]=1 表示 i→j 有边
 *      行是出发点，列是到达点（无向图沿对角线对称 M[i][j]===M[j][i]；有权图存权重，无边放 Infinity 避免与 0 权歧义）
 *      第 i 行之和 = 出度，第 i 列之和 = 入度
 *      增删查改 O(1) 很快，但空间 O(n²) 费 → "以空间换时间"，适合稠密图
 *
 *    - 邻接表（本文件的 GraphAdjList）：每个顶点存自己的邻居列表（Map + Set）
 *      空间 O(n+e) 省，但查边要遍历邻居列表 → "以时间换空间"，适合稀疏图
 *      链表过长时可换成红黑树 / 哈希表提升查询效率
 *
 * 3. 树是图的特例（无环连通图），树的遍历也是图遍历的特例
 *
 * 4. 遍历（同一框架：入容器 → 取出 → 查重 → 记结果 → 邻居没访问过就入容器，唯一的区别是容器）：
 *    - BFS：由近及远、层层扩张 → 队列（shift 取 + push 放，两端 = FIFO）
 *    - DFS：优先走到底、无路可走再回溯 → 栈（pop 取 + push 放，同端 = LIFO；递归写法本质也是栈）
 *      ⚠️ 取、放必须在同一端：pop+unshift / shift+push 都是两端，还是队列
 *      ⚠️ 出队/出栈后要查重（graph.has(e) 恒为 true 不算查重；res.includes(e) 或 Set）
 *    - 迭代 DFS 中邻居要逆序入栈，才能与图示/递归的访问顺序一致
 *
 * 5. 应用：社交网络、地铁线路等现实系统的建模
 *
 * 实测对照（graph3 = 0—1—2 / 0—3 / 2—5 / 4—5 / 5—6）：
 *   DFS(graph3, 0): [0,1,2,5,4,6,3]   深入到底再回溯
 *   BFS(graph3, 0): [0,1,3,2,5,4,6]   分层扩散
 *   BFS(graph2, 0): [0,1,3,2,4,6,5,7,8]  (3×3 网格)
 */

/* 基于邻接矩阵实现的无向图类 */
class GraphAdjMat {
    vertices; // 顶点列表，元素代表“顶点值”，索引代表“顶点索引”
    adjMat; // 邻接矩阵，行列索引对应“顶点索引”
    constructor(vertices, edges) {
        this.vertices = [];
        this.adjMat = [];
        // 添加顶点
        for (const val of vertices) {
            this.addVertex(val);
        }
        // 添加边
        // 请注意，edges 元素代表顶点索引，即对应 vertices 元素索引
        for (const e of edges) {
            this.addEdge(e[0], e[1]);
        }
    }
    size() {
        return this.vertices.length
    }
    addVertex(val) {
        const n = this.size()
        this.vertices.push(val);
        // 在邻接矩阵中添加一行
        const newRow = [];
        for (let j = 0; j < n; j++) {
            newRow.push(0);
        }
        this.adjMat.push(newRow);
        // 在邻接矩阵中添加一列
        for (const row of this.adjMat) {
            row.push(0);
        }
    }
    removeVertex(index) {
        if (index < 0 || index >= this.size()) {
            throw new Error('越界');
        }
        this.vertices.splice(index, 1);
        this.adjMat.splice(index, 1);
        for (const row of this.adjMat) {
            row.splice(index, 1);
        }
    }
    addEdge(i, j) {
        if (i < 0 || j < 0 || i >= this.size() || j >= this.size() || i === j) {
            throw new Error('越界');
        }
        this.adjMat[i][j] = 1;
        this.adjMat[j][i] = 1; // 无向图，对称位置都为1
    }
    removeEdge(i, j) {
        if (i < 0 || j < 0 || i >= this.size() || j >= this.size() || i === j) {
            throw new Error('越界');
        }
        this.adjMat[i][j] = 0;
        this.adjMat[j][i] = 0;
    }
    print() {
        console.log("顶点列表 =", this.vertices);
        console.log("邻接矩阵 =", this.adjMat);
    }
}

const graph = new GraphAdjMat([0, 1, 2, 3, 4], [[0, 1], [1, 2], [2, 3], [3, 4]]);
graph.print();

/* 基于邻接表实现的无向图类 */
class GraphAdjList {
    adjList; // 邻接表，索引代表顶点索引，值为邻接顶点列表
    constructor(edges) {
        this.adjList = new Map();
        for (const e of edges) {
            this.addVertex(e[0]);
            this.addVertex(e[1]);
            this.addEdge(e[0], e[1]);
        }
    }
    addVertex(val) {
        if (this.adjList.has(val)) return;
        this.adjList.set(val, new Set());
    }
    removeVertex(val) {
        if (!this.adjList.get(val)) return
        // 删除点
        this.adjList.delete(val);
        for (const set of this.adjList.values()) {
            // 遍历其他顶点的链表，删除所有包含 vet 的边
            set.delete(val)
        }
    }
    addEdge(i, j) {
        if (i === j || !this.adjList.has(i) || !this.adjList.has(j)) {
            throw new Error('错误🙅')
        }
        this.adjList.get(i).add(j);
        this.adjList.get(j).add(i);
    }
    removeEdge(i, j) {
        if (i === j || !this.adjList.has(i) || !this.adjList.has(j)) {
            throw new Error('错误🙅')
        }
        this.adjList.get(i).delete(j);
        this.adjList.get(j).delete(i);
    }
    print() {
        console.log("邻接表 =", this.adjList);
    }
}

// 3×3 网格图：9 个顶点，12 条边
//    0 —— 1 —— 2
//    |    |    |
//    3 —— 4 —— 5
//    |    |    |
//    6 —— 7 —— 8
const edges = [
    // 横边
    [0, 1], [1, 2],
    [3, 4], [4, 5],
    [6, 7], [7, 8],
    // 竖边
    [0, 3], [3, 6],
    [1, 4], [4, 7],
    [2, 5], [5, 8],
];
const graph2 = new GraphAdjList(edges);
graph2.print();
/**
 * 
  0 => Set(2) { 1, 3 },
  1 => Set(3) { 0, 2, 4 },
  2 => Set(2) { 1, 5 },
  3 => Set(3) { 4, 0, 6 },
  4 => Set(4) { 3, 5, 1, 7 },
  5 => Set(3) { 4, 2, 8 },
  6 => Set(2) { 7, 3 },
  7 => Set(3) { 6, 8, 4 },
  8 => Set(2) { 7, 5 }
 */

// 广度遍历 [0,1,3,2,4,6,5,7,8]
function graphBFS(graph, startVet) {
    const queue = [startVet]
    const ans = []
    while (queue.length) {
        const ver = queue.shift()
        if (ans.includes(ver))
            continue
        ans.push(ver)
        const e = graph.get(ver)
        for (const v of e) {
            if (!ans.includes(v)) {
                queue.push(v)
            }
        }
    }
    return ans
}
// console.log(graphBFS(graph2.adjList, 0));


// 7 个顶点，6 条边（图中灰线；蓝/橙虚线箭头是遍历步骤示意，不是边）
//    0 —— 1 —— 2
//    |         |
//    3    4 —— 5
//              |
//              6
const edges2 = [
    [0, 1], [1, 2],
    [0, 3],
    [2, 5],
    [4, 5], [5, 6],
];
const graph3 = new GraphAdjList(edges2);
graph3.print();

// 深度优先
function graphDFS(graph, startVet) {
    let res = []
    const dfs = (vet) => {
        if (res.includes(vet)) return
        res.push(vet)
        const list = graph.get(vet)
        for (const i of list) {
            dfs(i)
        }
    }
    dfs(startVet)
    return res
}
function graphDFS(graph, startVet) {
    let queue = [startVet]
    let res = []
    while (queue.length) {
        const e = queue.shift()
        if (graph.has(e) ) {
            res.push(e)
            const list = graph.get(e)
            for(let i of [...list].reverse()){
                if(!res.includes(i))
                queue.unshift(i)
            }
        }
    }
    return res
}
console.log(graphDFS(graph3.adjList, 0));
