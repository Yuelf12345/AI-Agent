/**
 * 
 * 有一个具有 n 个顶点的 双向 图，其中每个顶点标记从 0 到 n - 1（包含 0 和 n - 1）。图中的边用一个二维整数数组 edges 表示，其中 edges[i] = [ui, vi] 表示顶点 ui 和顶点 vi 之间的双向边。 每个顶点对由 最多一条 边连接，并且没有顶点存在与自身相连的边。
请你确定是否存在从顶点 source 开始，到顶点 destination 结束的 有效路径 。
给你数组 edges 和整数 n、source 和 destination，如果从 source 到 destination 存在 有效路径 ，则返回 true，否则返回 false 。
示例 1：
输入：n = 3, edges = [[0,1],[1,2],[2,0]], source = 0, destination = 2
输出：true
解释：存在由顶点 0 到顶点 2 的路径:
- 0 → 1 → 2 
- 0 → 2
 */
var validPath = function (n, edges, source, destination) {
    const graph = new Map()
    for (const [a, b] of edges) {
        if (!graph.has(a)) graph.set(a, new Set())
        if (!graph.has(b)) graph.set(b, new Set())
        graph.get(a).add(b)
        graph.get(b).add(a)
    }
    console.log(graph);
    const bfs = (graph, start, end) => {
        const queue = [start]
        const res = []
        while (queue.length) {
            const node = queue.shift()
            const e = graph.get(node)
            for (const i of e) {
                if (i === end) return true
                if (!res.includes(i)) {
                    res.push(i)
                    queue.push(i)
                }
            }
        }
        return false
    }
    return bfs(graph, source, destination)
};
// 7 个顶点，6 条边（图中灰线；蓝/橙虚线箭头是遍历步骤示意，不是边）
//    0 —— 1 —— 2
//    |         |
//    3    4 —— 5
//              |
//              6
console.log(validPath(7, [[0, 1], [1, 2],
[0, 3],
[2, 5],
[4, 5], [5, 6],], 0, 4));