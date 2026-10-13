class Node {
    constructor(val, next) {
        this.val = val;
        this.next = next;
    }
}
/* 初始化栈 */
{
    const stack = [];

    /* 元素入栈 */
    stack.push(1);
    stack.push(3);
    stack.push(2);
    stack.push(5);
    stack.push(4);

    /* 访问栈顶元素 */
    const peek = stack[stack.length - 1];

    /* 元素出栈 */
    const pop = stack.pop();

    /* 获取栈的长度 */
    const size = stack.length;

    /* 判断是否为空 */
    const is_empty = stack.length === 0;

    // 基于链表实现栈
    class LinkedListStack {
        constructor() {
            this.head = null;
            this.size = 0;
        }
        // 入栈
        push(val) {
            const node = new Node(val)
            node.next = this.head
            this.head = node
            this.size++
        }
        // 出栈
        pop() {
            if (this.head == null) return null
            const val = this.head.val
            this.head = this.head.next
            this.size--
            return val
        }
        // 栈长度
        length() {
            return this.size
        }
    }

    const stack2 = new LinkedListStack()
    stack2.push(1)
    stack2.push(3)
    stack2.push(2)
    stack2.push(5)
    stack2.push(4)
    console.log(stack2);
}
/* 初始化队列 */
{
    const queue = [];

    /* 元素入队 */
    queue.push(1);
    queue.push(3);
    queue.push(2);
    queue.push(5);
    queue.push(4);

    /* 访问队首元素 */
    const peek = queue[0];

    /* 元素出队 */
    // 底层是数组，因此 shift() 方法的时间复杂度为 O(n)
    const pop = queue.shift();

    /* 获取队列的长度 */
    const size = queue.length;

    /* 判断队列是否为空 */
    const empty = queue.length === 0;

    // 基于链表实现入队
    class LinkedListQueue {
        constructor() {
            this.head = null; // 队头
            this.tail = null; // 队尾
            this.size = 0;
        }
        // 入队
        push(val){
            const node = new Node(val)
            if(this.head == null){
                this.head = node
                this.tail = node
            }else{
                this.tail.next = node
                this.tail = node
            }
            this.size++
        }
        // 出队
        shift(){
            if(this.head == null) return null
            this.head = this.head.next
            this.size--
            return this.head.val 
        }
        // 队列长度
        length(){
            return this.size
        }
    }

    const queue2 = new LinkedListQueue()
    queue2.push(1)
    queue2.push(3)
    queue2.push(2)
    queue2.push(5)
    queue2.push(4)
    console.log(queue2);
}