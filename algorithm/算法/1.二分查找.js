/**
 * 搜索策略 - 重点回顾
 *
 *  二分查找依赖数据的有序性，通过循环逐步缩减一半搜索区间来进行查找。它要求输入数据有序，且仅适用于数组或基于数组实现的数据结构。
    暴力搜索通过遍历数据结构来定位数据。线性搜索适用于数组和链表，广度优先搜索和深度优先搜索适用于图和树。此类算法通用性好，无须对数据进行预处理，但时间复杂度O(n)较高。
    哈希查找、树查找和二分查找属于高效搜索方法，可在特定数据结构中快速定位目标元素。此类算法效率高，时间复杂度可达O(log n)甚至O(1)
 ，但通常需要借助额外数据结构。
    实际中，我们需要对数据规模、搜索性能要求、数据查询和更新频率等因素进行具体分析，从而选择合适的搜索方法。
    线性搜索适用于小型或频繁更新的数据；二分查找适用于大型、排序的数据；哈希查找适用于对查询效率要求较高且无须范围查询的数据；树查找适用于需要维护顺序和支持范围查询的大型动态数据。
    用哈希查找替换线性查找是一种常用的优化运行时间的策略，可将时间复杂度从 O(n)降至 O(1)
 */
/** 二分查找目标索引 */
function binarySearch(nums, target) {
    if (nums.length === 0 || target < nums[0] || target > nums[nums.length - 1]) return -1
    let left = 0
    let right = nums.length - 1
    while (left <= right) {
        const middleIndex = Math.floor((left + right) / 2)
        // console.log(middleIndex);
        if (nums[middleIndex] === target) {
            return middleIndex
        } else if (nums[middleIndex] > target) {
            right = middleIndex - 1
        } else {
            left = middleIndex + 1
        }
    }
    return -1
}
// console.log(binarySearch([1,2,3,4,5,6,7,8,9], 3));

/** 二分查找插入位置 无重复情况 */
function binarySearchInsertionSimple(nums, target) {
    let left = 0
    let right = nums.length - 1
    let middleIndex;
    while (left <= right) {
        middleIndex = Math.floor((left + right) / 2)
        if (nums[middleIndex] > target) {
            right = middleIndex - 1
        } else {
            left = middleIndex + 1
        }
    }
    return left // 插入点：循环退出时 left 恰好指向 target 应插入的位置
}
// console.log(binarySearchInsertionSimple([1,2,4,5,6,7,8,9], 10)); // 8（插到末尾）

/** 二分查找插入位置 有重复情况 插入最左侧 */
function binarySearchInsertion(nums, target) {
    let left = 0;
    let right = nums.length - 1
    while (left <= right) {
        let middleIndex = Math.floor((left + right) / 2)
        if (nums[middleIndex] >= target) {
            right = middleIndex - 1
        } else {
            left = middleIndex + 1
        }
    }
    return left // 循环退出时 left 恰好指向 target 应插入的位置
}
// console.log(binarySearchInsertion([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)); // 2
// console.log(binarySearchInsertion([1,2,3,3,3,4,4,5,6,7,8,9], 3)); // 2

/* 二分查找最左一个 target */
function binarySearchLeftEdge(nums, target) {
    // 等价于查找 target 的插入点
    const i = binarySearchInsertion(nums, target);
    // 未找到 target ，返回 -1
    if (i === nums.length || nums[i] !== target) {
        return -1;
    }
    // 找到 target ，返回索引 i
    return i;
}
/* 二分查找最右一个 target */
function binarySearchRightEdge(nums, target) {
    // 转化为查找最左一个 target + 1
    const i = binarySearchInsertion(nums, target + 1);
    // j 指向最右一个 target ，i 指向首个大于 target 的元素
    const j = i - 1;
    // 未找到 target ，返回 -1
    if (j === -1 || nums[j] !== target) {
        return -1;
    }
    // 找到 target ，返回索引 j
    return j;
}
// 我们可以构造一个数组中不存在的元素，用于查找左右边界