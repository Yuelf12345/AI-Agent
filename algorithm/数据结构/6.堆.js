/**
 * 堆（heap）是一种满足特定条件的完全二叉树，主要可分为两种类型
 *  小顶堆（min heap）：任意节点的值<=其子节点的值。
    大顶堆（max heap）：任意节点的值>=其子节点的值。
 * 重点回顾
 *
 * 1. 堆是一棵完全二叉树，根据成立条件可分为大顶堆和小顶堆。
 *    大（小）顶堆的堆顶元素是最大（小）的。
 * 2. 优先队列的定义是具有出队优先级的队列，通常使用堆来实现。
 * 3. 堆的常用操作及其对应的时间复杂度包括：
 *    元素入堆 O(log n)、堆顶元素出堆 O(log n) 和访问堆顶元素 O(1) 等。
 * 4. 完全二叉树非常适合用数组表示，因此我们通常使用数组来存储堆。
 * 5. 堆化操作（siftUp / siftDown）用于维护堆的性质，在入堆和出堆操作中都会用到。
 * 6. 输入 n 个元素并建堆的时间复杂度可以优化至 O(n)，非常高效。
 * 7. Top-k 是一个经典算法问题，可以使用堆数据结构高效解决，时间复杂度为 O(n log k)。
 */

/* 获取左子节点的索引 */
function left(i) {
    return 2 * i + 1
}
function right(i) {
    return 2 * i + 2
}
/* 获取父节点的索引 */
function parent(i) {
    return Math.floor((i - 1) / 2)
}
// const maxHeap = [9, 8, 6, 6, 7, 5, 2, 1, 4, 3, 6, 2]
// const maxHeap = [9, 8, 7, 6, 7, 6, 2, 1, 4, 3, 6, 2, 5]
const maxHeap = [1,2,3,4,5,6,7,8,9,10]

function siftUp(i) {
    while(true){
        const p = parent(i)
        // 退出条件 当前节点比父节点小
        if(maxHeap[i] < maxHeap[p]){
            break
        }
        const temp = maxHeap[i]
        maxHeap[i] = maxHeap[p]
        maxHeap[p] = temp
        i = p
    }
}
/**
 * 入堆
 * @param {*} val 
 * 1. 尾部插入
 * 2. 如果大于父节点 与父节点交换位置
 */
function push(val) {
    maxHeap.push(val)
    siftUp(maxHeap.length - 1)
}
// push(7)
// console.log(maxHeap);


function siftDown(i){
    while(true){
        const l = left(i)
        const r = right(i)
        let max = i
        // 找到当前节点与两个子节点中最大的那个
        if(l < maxHeap.length && maxHeap[l] > maxHeap[max]){
            max = l
        }
        if(r < maxHeap.length && maxHeap[r] > maxHeap[max]){
            max = r
        }
        // 退出条件 当前节点就是最大的
        if(max === i){
            break
        }
        // 交换位置
        [maxHeap[i], maxHeap[max]] = [maxHeap[max], maxHeap[i]]
        i = max
    }
}
/**
 * 出堆
 * 1. 当前节点与尾节点交换
 * 2. 删除尾节点
 * 3. 当前节点与子节点比较, 与最大的那个交换位置
 */
function pop(i){
    [maxHeap[i],maxHeap[maxHeap.length - 1]] = [maxHeap[maxHeap.length - 1], maxHeap[i]]
    maxHeap.pop()
    siftDown(i)
}
// pop(0)

/**
 * 建堆操作
 * 1. 数组本身就是完全二叉树的层序存储（父 i，左右子 2i+1 / 2i+2）
 * 2. 叶节点没有子节点，天然满足堆性质，无需处理
 * 3. 从最后一个非叶节点开始，倒序对每个节点执行 siftDown
 *    倒序保证：处理父节点时，它的两个子树已经是合法的堆
 * 时间复杂度 O(n)（节点越靠下越多、下沉距离越短，错项求和结果）
 */
function buildHeap() {
    // 最后一个节点的父节点 = 最后一个非叶节点
    for (let i = parent(maxHeap.length - 1); i >= 0; i--) {
        siftDown(i)
    }
}
console.log("建堆前:", maxHeap)
buildHeap()
console.log("建堆后:", maxHeap);


/**
 * 取top-k
 * 1.构建小顶堆(可以用现有函数将堆中所有元素取反，用大顶堆来模拟小顶堆)
 * 2.将数组的前 k 个元素入堆
 * 3.若当前元素大于堆顶元素，则将堆顶元素出堆、当前元素入堆顶后下沉
 * 4.返回堆
 */
function topKHeap(nums, k){
    /**
     * 函数
     */
    const getLeft = (i) => 2*i +1
    const getRight = (i) => 2*i + 2
    const getParent = (i) => Math.floor((i-1)/2)
    const minPush = (heap, val) => {
        heap.push(val)
        let i = heap.length - 1
        while(i){
            const p = getParent(i)
            if(!p || heap[i] > heap[p]) break
            [heap[i], heap[p]] = [heap[p], heap[i]]
            i = p
        }
    }
    const minSiftDown = (heap,i) =>{
        while(true){
            const l = getLeft(i)
            const r = getRight(i)
            let min = i
            if(l < heap.length && heap[l] < heap[min]) min = l
            if(r < heap.length && heap[r] < heap[min]) min = r
            if(min === i) break
            [heap[i], heap[min]] = [heap[min], heap[i]]
            i = min
        }
    }
    // 1. 构建小顶堆
    const minHeap = []
    // 2. 前k入堆 堆顶是最小值
    for(let i = 0; i < k; i++){
        minPush(minHeap, nums[i])
    }
    // 3. 若当前元素大于堆顶元素，则将堆顶元素出堆、当前元素入堆顶后下沉
    for(let i = k; i < nums.length; i++){
        if(nums[i] > minHeap[0]){
            minHeap[0] = nums[i]
            minSiftDown(minHeap, 0) 
        }
    }
    return minHeap
}
console.log(topKHeap([1,7,6,3,2], 3));
