/** 选择最小的值与当前交换 */
function selectionSort(arr) {
    let len = arr.length
    for (let i = 0; i < len; i++) {
        let m = i
        for (let j = i + 1; j < len; j++) {
            if (arr[j] < arr[m]) m = j
        }
        [arr[i], arr[m]] = [arr[m], arr[i]]
    }
    return arr
}
// console.log(selectionSort([64, 34, 25, 12, 22, 11, 90]));
/** 比较前后两个值 */
function bubbleSort(arr) {
    let len = arr.length
    for (let i = 0; i < len; i++) {
        for (let j = 0; j < len - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]]
            }
        }
    }
    return arr
}
// console.log(bubbleSort([64, 34, 25, 12, 22, 11, 90]));
/** 将值插入到已排序的数组中 */
function insertionSort(arr) {
    let len = arr.length
    for (let i = 1; i < len; i++) {
        let curr = arr[i]
        let j = i - 1
        while (j >= 0 && arr[j] > curr) {
            arr[j + 1] = arr[j]
            j--
        }
        arr[j + 1] = curr
    }
    return arr
}
// console.log(insertionSort([64, 34, 25, 12, 22, 11, 90]));

/** 快速排序 */
function quickSort(arr) {
    if (arr.length <= 1) return arr
    let middle = Math.floor(arr.length / 2)
    let pivot = arr[middle]
    let left = []
    let right = []
    for (let i = 0; i < arr.length; i++) {
        if (i === middle) continue // 基准数必须出列,否则它永远卡在 right 里导致无限递归
        if (arr[i] < pivot) {
            left.push(arr[i])
        } else {
            right.push(arr[i])
        }
    }
    return [...quickSort(left), pivot, ...quickSort(right)]
}
// console.log(quickSort([1, 3, 2, 4]));

/** 快速排序2 */
/** 
 * 右指针遇到小于pivot的就交换 右--
 * 左指针遇到大于pivot的就交换 左++
 * 64
 * -, 34, 25, 12, 22, 11, 90
 * 11, 34, 25, 12, 22, -, 90
 * 11, 34, 25, 12, 22, 64, 90
 */
// 分区函数
function partition(arr, left, right) {
    let pivot = arr[left]
    let i = left
    let j = right
    while (i < j) {
        while (i < j && arr[j] >= pivot) j-- // 右哨兵 找到比基数小的
        arr[i] = arr[j]
        while (i < j && arr[i] <= pivot) i++
        arr[j] = arr[i]
    }
    arr[i] = pivot
    return i
}
function quickSort2(arr, left = 0, right = arr.length - 1) {
    if (left >= right) return arr
    const mid = partition(arr, left, right)
    quickSort2(arr, left, mid - 1)
    // 右区间
    quickSort2(arr, mid + 1, right)
    return arr
}
// console.log(quickSort2([64, 34, 25, 12, 22, 11, 90]));
// console.log(quickSort2([5, 4, 3, 2, 1]));   // 逆序
// console.log(quickSort2([1, 2, 3, 4, 5]));   // 已有序
// console.log(quickSort2([3, 3, 3, 3]));      // 全相等
// console.log(quickSort2([2, 3, 1, 3, 1, 4, 2])); // 大量重复
// console.log(partition([64, 34, 25, 12, 22, 11, 90], 0, 6))

/** 归并排序 */
/* 合并左子数组和右子数组 */
function merge(nums, left, mid, right) {
    // 左子数组区间为 [left, mid], 右子数组区间为 [mid+1, right]
    // 创建一个临时数组 tmp ，用于存放合并后的结果
    const tmp = new Array(right - left + 1);
    // 初始化左子数组和右子数组的起始索引
    let i = left,
        j = mid + 1,
        k = 0;
    // 当左右子数组都还有元素时，进行比较并将较小的元素复制到临时数组中
    while (i <= mid && j <= right) {
        if (nums[i] <= nums[j]) {
            tmp[k++] = nums[i++];
        } else {
            tmp[k++] = nums[j++];
        }
    }
    // 将左子数组和右子数组的剩余元素复制到临时数组中
    while (i <= mid) {
        tmp[k++] = nums[i++];
    }
    while (j <= right) {
        tmp[k++] = nums[j++];
    }
    // 将临时数组 tmp 中的元素复制回原数组 nums 的对应区间
    for (k = 0; k < tmp.length; k++) {
        nums[left + k] = tmp[k];
    }
}
/* 归并排序 */
function mergeSort(nums, left, right) {
    // 终止条件
    if (left >= right) return; // 当子数组长度为 1 时终止递归
    // 划分阶段
    let mid = Math.floor(left + (right - left) / 2); // 计算中点
    mergeSort(nums, left, mid); // 递归左子数组
    mergeSort(nums, mid + 1, right); // 递归右子数组
    // 合并阶段
    merge(nums, left, mid, right);
}
{
    function merge(arr1, arr2) {
        let i = 0, j = 0
        const arr = []
        while (i < arr1.length && j < arr2.length) {
            if (arr1[i] <= arr2[j]) {
                arr.push(arr1[i++])
            } else {
                arr.push(arr2[j++])
            }
        }
        const res = arr.concat(i === arr1.length ? arr2.slice(j) : arr1.slice(i))
        return res
    }

    function mergeSort(arr) {
        if (arr.length <= 1) return arr
        const mid = Math.floor(arr.length / 2)
        return merge(mergeSort(arr.slice(0, mid)),   // 左半 [0, mid)
            mergeSort(arr.slice(mid)))      // 右半 [mid, 末尾)
    }
}
// console.log(mergeSort([64, 34, 25, 12, 22, 11, 90]));
// console.log(merge([10, 34, 64, 90], [11, 22, 25]));
// merge([1, 5], [2, 3, 4]) 
// merge([], [7, 8])
// merge([2, 2, 4], [1, 3])
// 64, 34, 25,10
// 64, 34.  25,10
// 34  64. 25 10

/** 堆排序 */
function siftDown(nums, len, i) {
    while (true) {
        const l = 2 * i + 1
        const r = 2 * i + 2
        let max = i
        if (l < len && nums[max] < nums[l]) max = l
        if (r < len && nums[max] < nums[r]) max = r
        if (max === i) break;
        [nums[i], nums[max]] = [nums[max], nums[i]]
        i = max
    }
}
function heapSort(nums) {
    const len = nums.length
    // 1. 建立大堆顶
    for (let i = Math.floor(nums.length / 2) - 1; i >= 0; i--) {
        siftDown(nums, len, i)
    }
    for (let i = len - 1; i > 0; i--) {
        [nums[0],nums[i]] = [nums[i],nums[0]]
         siftDown(nums, i, 0)
    }
    return nums
}
console.log(heapSort([64, 34, 25, 12, 22, 11, 90]));