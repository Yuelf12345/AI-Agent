import { v7 as uuid7 } from "uuid";
import {
  StateGraph,
  MemorySaver,
  START,
  Annotation,
  interrupt,
  Command,
} from "@langchain/langgraph";

// 声明图的状态结构
const StateAnnotation = Annotation.Root({
  topic: Annotation<string>(),
  // topic: Annotation<string>({
  //   reducer: (left, right) => right ?? left, // 新值优先
  //   default: () => "",
  // }),
  joke: Annotation<string>(),
});

function generateTopic(state: typeof StateAnnotation.State) {
  return { topic: state.topic ?? "socks in the dryer" };
}

function writeJoke(state: typeof StateAnnotation.State) {
  return { joke: `Why do ${state.topic} disappear? They elope!` };
}

const graph = new StateGraph(StateAnnotation)
  .addNode("generateTopic", generateTopic)
  .addNode("writeJoke", writeJoke)
  .addEdge(START, "generateTopic")
  .addEdge("generateTopic", "writeJoke")
  .compile({
    checkpointer: new MemorySaver(), // 状态持久化器，负责在图执行过程中自动保存状态快照（检查点）。
    // interruptBefore: ["writeJoke"], // 在这些节点前暂停
    // interruptAfter: ["writeJoke"], // 在这些节点后暂停
    // recursionLimit: 100, // 最大递归深度
  }); // 编译阶段（生成可执行图）

const config = { configurable: { thread_id: uuid7() } };
// 1. 直接调用查看结果
const result = await graph.invoke({}, config);
console.log("result", result);
// 2. 获取状态历史
const states: any = [];
for await (const state of graph.getStateHistory(config)) {
  states.push(state);
}
// 3. 找到特定检查点
const beforeJoke = states.find((s) => s.next.includes("writeJoke"));
// console.log("beforeJoke", beforeJoke);
// 4. 回放（Replay) null(表示不传入新输入，从保存的状态继续) --> 结果与原始执行相同（确定性图）
const replayResult = await graph.invoke(null, beforeJoke.config);
console.log("replayResult", replayResult);
// 5. 覆盖方法
//  方案 1：使用 Annotation 的 reducer
{
  const StateAnnotation = Annotation.Root({
    topic: Annotation<string>({
      reducer: (left, right) => right ?? left, // 新值优先
      default: () => "",
    }),
    joke: Annotation<string>(),
  });
  const replayResult = await graph.invoke(
    /**
   *  无效
    START → generateTopic (已执行) → [checkpoint] → writeJoke → END
    从 checkpoint 恢复：
    [checkpoint] → writeJoke → END  (跳过 generateTopic)
   */
    /**
     * 使用 Annotation 的 reducer（推荐）
     */
    { topic: "shoes in the closet???" },
    beforeJoke.config,
  );
  // console.log("replayResult (override)", replayResult);
}
// 方案 2：手动构建状态后继续（有效）
{
  // 手动构建新状态（清除 joke）
  const newState = {
    topic: "shoes in the closet!!!",
    joke: undefined,
  };
  // 创建新 thread，手动设置初始状态
  const newConfig = { configurable: { thread_id: uuid7() } };
  const replayResult = await graph.invoke(newState, newConfig);
  // console.log("replayResult (manual state)", replayResult);
}
// 方案 3: Fork
{
  const forkConfig = await graph.updateState(beforeJoke.config, {
    topic: "chickens",
  });
  const forkResult = await graph.invoke(null, forkConfig); // 不能使用 beforeJoke.config 因为它指向的是之前的检查点
  // console.log("forkResult", forkResult);
}

const interruptFn = async () => {
  function askHuman(state: { value: string[] }) {
    const answer = interrupt("What is your name?");
    return { value: [`Hello, ${answer}!`] };
  }
  function finalStep(state: { value: string[] }) {
    return { value: ["Done"] };
  }
  await graph.invoke({ topic: "hello" }, config);
  await graph.invoke(new Command({ resume: "Alice" }), config);
  const states: any = [];
  for await (const state of graph.getStateHistory(config)) {
    states.push(state);
  }
  const beforeAsk = states.filter((s) => s.next.includes("askHuman")).pop();
  console.log("beforeAsk", beforeAsk);
  const replayResult = await graph.invoke(null, beforeAsk.config);
  const forkConfig = await graph.updateState(beforeAsk.config, {
    value: ["forked"],
  });
  const forkResult = await graph.invoke(null, forkConfig);
  await graph.invoke(new Command({ resume: "Bob" }), forkConfig);
};
