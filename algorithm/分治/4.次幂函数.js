/**
 * 实现 pow(x, n) ，即计算 x 的整数 n 次幂函数（即，X^n ）。
 *  输入：x = 2.00000, n = 10
    输出：1024.00000
 */
/**
 * @param {number} x
 * @param {number} n
 * @return {number}
 */
var myPow = function (x, n) {
    if (n === 0) return 1 // n=0直接返回1
    if (n < 0) {   				//n<0时 x的n次方等于1除以x的-n次方分
        return 1 / myPow(x, -n)
    }
    if (n % 2) {    //n是奇数时 x的n次方 = x*x的n-1次方
        return x * myPow(x, n - 1)
    }
    return myPow(x * x, n / 2) //n是偶数，使用分治，一分为二，等于x*x的n/2次方 
};
console.log(myPow(2, -2));
console.log(Math.pow(2, -2));