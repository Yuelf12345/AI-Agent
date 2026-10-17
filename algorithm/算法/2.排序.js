/** 选择最小的值与当前交换 */
function selectionSort(arr) {
    let len = arr.length
    for (let i = 0; i < len; i++) {
        let m = i
        for (let j = i + 1; j < len - 1; j++) {
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
    for (let i = 0; i < len - 1; i++) {
        for (let j = 0; j < len - 1 - i; j++) {
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
    return [...quickSort(left), pivot, ...quickSort(right)] // 这里添加基准数
}
// console.log(quickSort([64, 34, 25, 12, 22, 11, 90, 30, 12]));

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
function mergeSort(nums, left = 0, right = nums.length - 1) {
    // 终止条件
    if (left >= right) return; // 当子数组长度为 1 时终止递归
    // 划分阶段
    let mid = Math.floor(left + (right - left) / 2); // 计算中点
    mergeSort(nums, left, mid); // 递归左子数组
    mergeSort(nums, mid + 1, right); // 递归右子数组
    // 合并阶段
    merge(nums, left, mid, right);
    return nums
}
{
    function merge2(arr1, arr2) {
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

    function mergeSort2(arr) {
        if (arr.length <= 1) return arr
        const mid = Math.floor(arr.length / 2)
        return merge2(mergeSort2(arr.slice(0, mid)),   // 左半 [0, mid)
            mergeSort2(arr.slice(mid)))      // 右半 [mid, 末尾)
    }


    var sortArray = function (nums) {
        if (nums.length <= 1) return nums
        const mid = Math.floor(nums.length / 2)
        const left = sortArray(nums.slice(0, mid))
        const right = sortArray(nums.slice(mid))
        let i = 0; j = 0; k = 0; res = []
        while (i < left.length && j < right.length) {
            if (left[i] < right[j]) {
                res[k++] = left[i++]
            } else {
                res[k++] = right[j++]
            }
        }
        while (i < left.length) res[k++] = left[i++]
        while (j < right.length) res[k++] = right[j++]
        return res
    };
    console.log(sortArray([64, 34, 25, 12, 22, 11, 90, 30]));
}
// console.log(mergeSort([64, 34, 25, 12, 22, 11, 90, 30]));
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
        [nums[0], nums[i]] = [nums[i], nums[0]]
        siftDown(nums, i, 0)
    }
    return nums
}
// console.log(heapSort([64, 34, 25, 12, 22, 11, 90, 30]));

/* 桶排序（通用版：不要求数据落在 [0, 1)，整数、任意范围浮点数均可） */
function bucketSort(nums) {
    const n = nums.length;
    if (n <= 1) return nums;

    // 0. 新增：求出数据的实际范围 [min, max]
    let min = nums[0];
    let max = nums[0];
    for (const num of nums) {
        if (num < min) min = num;
        if (num > max) max = num;
    }
    if (min === max) return nums; // 所有元素相同，已天然有序

    // 初始化 k = n/2 个桶，预期向每个桶分配 2 个元素
    const k = Math.max(1, Math.floor(n / 2));
    const buckets = [];
    for (let i = 0; i < k; i++) {
        buckets.push([]);
    }
    // 1. 将数组元素分配到各个桶中
    const width = (max - min) / k; // 每个桶负责的数值宽度
    for (const num of nums) {
        // 书上的 num * k 等价于 (num - 0) / (1 - 0) * k，
        // 也就是「min = 0、range = 1」这一种特例。这里换成通式：
        let i = Math.floor((num - min) / width);
        if (i >= k) i = k - 1; // num === max 时恰好落在右边界，收进最后一个桶
        // 将 num 添加进桶 i
        buckets[i].push(num);
    }
    // 2. 对各个桶执行排序
    for (const bucket of buckets) {
        // 使用内置排序函数，也可以替换成其他排序算法
        bucket.sort((a, b) => a - b);
    }
    // 3. 遍历桶合并结果
    let i = 0;
    for (const bucket of buckets) {
        for (const num of bucket) {
            nums[i++] = num;
        }
    }
    return nums
}
// console.log(bucketSort([64, 34, 25, 12, 22, 11, 90, 30]));

/** 计数排序 */
function countingSortNaive(nums) {
    let m = Math.max(...nums);
    const counter = new Array(m + 1).fill(0);
    for (const num of nums) {
        counter[num]++
    }
    let i = 0;
    console.log('counter', counter);
    for (let num = 0; num < m + 1; num++) {
        for (let j = 0; j < counter[num]; j++, i++) {
            nums[i] = num;
        }
    }
    return nums
}
// console.log(countingSortNaive([64, 34, 25, 12, 22, 11, 90, 30]));

/* 基数排序 */
function countingSortDigit(nums) {
    const n = nums.length;
    if (n <= 1) return nums; // 空数组或单元素，无需排序

    // 1. 统计数组最大元素 m（要求 nums 全为非负整数）
    let m = 0;
    for (const num of nums) {
        m = Math.max(m, num);
    }

    // 2. 统计各数字的出现次数：counter[num] 代表 num 的出现次数
    const counter = new Array(m + 1).fill(0);
    for (const num of nums) {
        counter[num]++;
    }

    // 3. 求 counter 的前缀和，把「出现次数」转换为「尾索引」
    //    求完后 counter[num] - 1 就是 num 在结果数组中最后一次出现的索引
    for (let i = 0; i < m; i++) {
        counter[i + 1] += counter[i];
    }

    // 4. 倒序遍历 nums，把每个元素填到它在结果数组中的最终位置
    //    倒序是为了保证稳定性：相同元素中靠后的先落位，靠前的落在它左边
    const res = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        const num = nums[i];
        counter[num]--;          // 占掉一个「尾索引」，下一个相同元素往前挪一格
        res[counter[num]] = num;
    }

    // 5. 把结果写回原数组
    for (let i = 0; i < n; i++) {
        nums[i] = res[i];
    }
    return nums;
}
// console.log(countingSortDigit([64, 34, 25, 12, 22, 11, 90, 30]));
// console.log(countingSortDigit([121,212,222,111,21,12]));

