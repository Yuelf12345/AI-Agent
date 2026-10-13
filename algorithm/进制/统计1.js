// 统计二进制表示中的 1
// 给定非负整数 n，请统计它的二进制表示中共有多少个 1。
// 要求使用位运算完成，不把二进制表示转换成字符串，也不使用直接统计 1 的内置函数。
// 5 0101 -> 2. 7 0111 -> 3

function countOnes(n) {
    let count = 0
    while(n){
        count = n & 1
        n >>= 1
        count++
    }
}

console.log(countOnes(5));
