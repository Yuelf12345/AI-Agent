/**
 * 比较两个字符串的字符组成¶
    给定两个只含小写英文字母的字符串 s 和 t。 可以任意调整 s 中字符的位置，但不能添加、删除或替换字符。
    请判断调整后能否得到 t；可以则返回 true，否则返回 false。 请使用哈希表记录各字母的出现次数，不对字符串中的字符排序。
 */
function diff(s,t){
    if(s.length!=t.length)return false;
    const map = new Map();
    for(let i=0;i<s.length;i++){
        map.set(s[i],(map.get(s[i]) || 0)+1)
    }
    for(let i=0;i<t.length;i++){
        if(map.get(t[i])>0){
            map.set(t[i],map.get(t[i])-1)
        }else{
            return false
        }
    }
    return true;
}

console.log(diff('aab','abb'));
console.log(diff('abcc','cbca'));

