# 构建 RAG 系统速成课程 — Part 1（含实现）

> **原文链接**: [https://www.dailydoseofds.com/a-crash-course-on-building-rag-systems-part-1-with-implementations/](https://www.dailydoseofds.com/a-crash-course-on-building-rag-systems-part-1-with-implementations/)
>
> **作者**: Avi Chawla & Akshay Pachaar | **来源**: Daily Dose of Data Science

---

## 引言

在过去几周里，我们花了大量时间来理解真实世界 NLP 系统的关键组件：

- [Bi-encoders 和 Cross-encoders 用于句子对相似度评分 — Part 1](https://www.dailydoseofds.com/bi-encoders-and-cross-encoders-for-sentence-pair-similarity-scoring-part-1/) — 深入探讨为什么 BERT 对句子相似度效果不佳，以及永远改变了这一任务的进展。
- [AugSBERT: Bi-encoders + Cross-encoders 用于句子对相似度评分 — Part 2](https://www.dailydoseofds.com/augsbert-bi-encoders-cross-encoders-for-sentence-pair-similarity-scoring-part-2/) — 深入探讨 cross-encoders 和 bi-encoders 在句子对相似度方面的扩展。

此外，我们还讨论了向量数据库。向量数据库并非新技术，但在 GenAI 时代变得极为流行，主要是因为它们不仅在 LLM 中有实际用途，在其他应用中也是如此。

- [向量数据库的入门友好全面深度指南](https://www.dailydoseofds.com/a-beginner-friendly-and-comprehensive-deep-dive-on-vector-databases/) — 理解向量数据库的每一个细节及其在 LLM 中的用途，附带实操演示。

更具体地说，向量数据库在构建 RAG 应用时非常有用。RAG 是一种结合了大语言模型（LLM）与外部知识源优势的技术。

如下所示。

![典型的 RAG 设置](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/10/rag.gif)

本速成课程的目标是帮助你使用 Qdrant、LlamaIndex 和 Ollama 等框架**从零开始实现**这些 RAG 系统。

当然，如果你不了解这些框架也不用担心，这正是我们今天要讲的内容，我们会像往常一样提供充分的背景说明。

本综合速成课程将从理解 RAG 的必要性出发，深入探讨 RAG，然后覆盖构建你自己 RAG 系统的实操方法。

到本文结束时，你将对 RAG 及如何在自己的应用中使用它有扎实的理解。

让我们开始吧！

---

## 向量数据库回顾

> 如果你已经了解向量数据库，或者之前已经读过 [向量数据库深度指南](https://www.dailydoseofds.com/a-beginner-friendly-and-comprehensive-deep-dive-on-vector-databases/#using-vector-databases-in-llms)，可以跳过本节。

### 什么是向量数据库？

简单来说，向量数据库以**向量嵌入**的形式存储非结构化数据（文本、图像、音频、视频等）。

![向量数据库概览](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-160.png)

每个数据点——无论是词、文档、图像还是其他实体——都通过机器学习技术被转换为一个数值向量（我们将在后面看到具体过程）。

这个数值向量被称为**嵌入（embedding）**，模型的训练方式使得这些向量能够捕获底层数据的本质特征和特性。

以词嵌入为例，我们可能会发现，在嵌入空间中，水果的嵌入彼此靠近，而城市形成另一个聚类，等等。

![嵌入聚类](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-161.png)

这说明嵌入能够学习其所代表实体的语义特征（前提是模型经过适当训练）。

一旦存储在向量数据库中，我们就可以检索与我们想要在非结构化数据上运行的查询相似的原对象。

![向量数据库中的相似度搜索](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-162.png)

换句话说，编码非结构化数据使我们能够对其进行许多复杂操作——如相似度搜索、聚类和分类——而这些操作在传统数据库上是很难实现的。

> 💡 举个例子，当电商网站为相似商品提供推荐或根据输入查询搜索产品时，我们在大多数情况下实际上是在与后台的向量数据库交互。

### 向量数据库的目的

想象我们有一组历年各种度假旅行中拍摄的照片。每张照片捕捉了不同的场景——海滩、山脉、城市和森林。

![度假照片](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-163.png)

现在，我们想以一种更容易快速找到相似照片的方式来组织这些照片。

传统上，我们可能按照拍摄日期或拍摄地点来组织它们。

![传统照片组织方式](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-164.png)

然而，我们可以采取一种更高级的方法——将它们编码为向量。

更具体地说，不再仅仅依赖日期或位置，我们可以将每张照片表示为一组捕获图像本质的数值向量。

> 💡 虽然 Google Photos 没有明确披露其后台系统的确切技术细节，但我推测它使用向量数据库来支持其图像搜索和组织功能，你可能已经用过很多次了。

假设我们使用一种算法，根据每张照片的颜色构成、主要形状、纹理、人物等将其转换为向量。

每张照片现在被表示为多维空间中的一个点，其中的维度对应于图像中不同的视觉特征和元素。

现在，当我们想找到相似的照片——比如说，基于我们输入的文本查询——我们将文本查询编码为向量并与图像向量进行比较。

与查询匹配的照片预期在多维空间中具有彼此靠近的向量。

假设我们想查找山脉的图像。

![查找山脉图像](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-166.png)

由于向量同时维护嵌入和生成这些嵌入的原始数据，我们可以通过在向量数据库中查询与输入查询向量接近的图像来快速找到这类照片。

![在向量数据库中查询图像](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-165.png)

简单，是不是？

当然，由于向量数据库可能有数百万个向量，传统的最近邻搜索是不可行的，因为它会与所有向量进行相似度测量。

![传统搜索 vs ANN 搜索](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image.png)

这就是为什么我们需要**近似最近邻（Approximate Nearest Neighbor, ANN）搜索算法**。

其核心思想是缩小查询向量的搜索空间，从而提升运行时性能。

![ANN 算法](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-187.png)

虽然它们通常比精确最近邻方法牺牲一定程度的精度，但它们提供了显著的性能增益，特别是在需要实时或近实时响应的场景中。

我们在下面讨论了几种 ANN 算法：

- [向量数据库的入门友好全面深度指南](https://www.dailydoseofds.com/a-beginner-friendly-and-comprehensive-deep-dive-on-vector-databases/#using-vector-databases-in-llms) — 理解向量数据库的每一个细节及其在 LLM 中的用途，附带实操演示。

### 向量数据库在 RAG 中的用途

至此，一个有趣的问题是：LLM 到底是如何利用向量数据库的？

根据我的经验，人们通常面临的最大困惑是：

> 一旦我们训练了 LLM，它就拥有了用于文本生成的模型权重。向量数据库在这里又扮演什么角色呢？

让我们来理解这个问题。

首先，我们必须理解 LLM 是在训练时所获得的语料库的静态版本上进行学习后才部署的。

![LLM 在静态语料库上训练](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-243.png)

例如，如果模型在考虑截至 `2024 年 1 月 31 日` 的数据后部署，而我们在训练一周后使用它，它对那几天发生的事情将毫无所知。

![LLM 不了解训练数据之后的知识](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-244.png)

每天在新数据上反复训练新模型（或调整最新版本）既不实际也不经济。事实上，LLM 的训练可能需要数周时间。

另外，如果我们开源了 LLM，其他人想在自己的私有数据集上使用它——当然这些数据在训练时并未出现过——该怎么办？

正如预期的那样，LLM 对此将毫无所知。

![LLM 对私有数据毫无所知](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-245.png)

但仔细想想，训练一个 LLM 让它知道世界上所有的事情，真的是我们的目标吗？

根本不是！

那不是我们的目标。

相反，更重要的是帮助 LLM 学习语言的总体结构，以及如何理解和生成语言。

![LLM 学习语言结构](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-246.png)

所以，一旦我们在一个足够庞大的训练语料库上训练了这个模型，就可以期望模型具有相当水平的语言理解和生成能力。

因此，如果我们能找到一种方法，让 LLM 查找它们未训练过的新信息，并在文本生成中使用这些信息（**无需重新训练模型**），那就太好了！

一种方法是在 prompt 中直接提供这些信息。

![在 prompt 中提供信息](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-248.png)

但由于 LLM 通常对上下文窗口（可接受的词/token 数量）有限制，额外信息可能会超出该限制。

**向量数据库解决了这个问题。**

如前文所述，向量数据库以向量形式存储信息，其中每个向量捕获被编码文本片段的语义信息。

因此，我们可以通过使用嵌入模型将可用信息编码为向量，在向量数据库中维护这些信息。

![在向量数据库中存储信息](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-249.png)

当 LLM 需要访问这些信息时，它可以使用 prompt 向量通过近似相似度搜索来查询向量数据库，以找到与输入查询向量相似的内容。

![在向量数据库中查询相关信息](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-250.png)

一旦检索到近似最近邻，我们就收集与这些特定向量对应的上下文——这些上下文是在将数据索引到向量数据库时存储的（这些原始数据作为 payload 存储，我们将在实现中学习）。

![从检索向量中收集上下文](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-253.png)

上述搜索过程检索到与查询向量相似的上下文，查询向量代表了 LLM 感兴趣的上下文或主题。

我们可以将检索到的内容与用户提供的实际 prompt 合并增强，并将其作为 LLM 的输入。

![将检索内容与用户 prompt 合并增强](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/02/image-254.png)

因此，LLM 可以在生成文本时轻松地整合这些信息，因为它现在在 prompt 中拥有了相关的细节。

这就被称为**检索增强生成（Retrieval-Augmented Generation, RAG）**，解释如下：

![RAG 缩写含义解释](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-1.png)

- **Retrieval（检索）**：从知识源（如数据库或记忆）中访问和检索信息。
- **Augmented（增强）**：增强或丰富某物，在此场景下是增强文本生成过程，为其提供额外信息或上下文。
- **Generation（生成）**：创造或产生某物的过程，在此语境下是生成文本或语言。

通过 RAG，语言模型可以使用从向量数据库中检索到的信息（这些信息预期是可靠的），确保其回答扎根于现实世界的知识和上下文，从而减少幻觉的可能性。

这使得模型的回答更准确、可靠且与上下文相关，同时也确保我们无需在新数据上反复训练 LLM。这使模型的回答更加"实时"。

既然我们理解了其用途，接下来就进入技术细节。

---

## RAG 系统的工作流程

要构建一个 RAG 系统，关键是要理解其基础组件以及它们之间的交互方式。因此，在本节中，让我们详细探讨每个组件。

以下是典型 RAG 设置的架构图：

![RAG 架构图](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-2.png)

让我们逐步分解。

我们从一些训练中未见过的外部知识开始，我们想要用它来增强 LLM：

![外部知识](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-5.png)

### 1) 创建分块

第一步是将这些额外知识分解为分块（chunks），然后再进行嵌入和存储到向量数据库。

![创建分块](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-6.png)

我们这样做是因为额外的文档可能非常大。因此，重要的是确保文本适配嵌入模型的输入大小。

![分块大小必须适配嵌入模型](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-7.png)

此外，如果不做分块，整个文档将只有一个嵌入，这对于检索相关上下文没有任何实际用途。

我们最近在 newsletter 中讨论了分块策略：

- [RAG 的 5 种分块策略](https://blog.dailydoseofds.com/p/5-chunking-strategies-for-rag?ref=dailydoseofds.com) — 在一帧中解释。

![分块策略](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/chunking-rag.gif)

### 2) 生成嵌入

分块之后，我们使用嵌入模型对分块进行嵌入。

![生成嵌入](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-9.png)

由于这些是"上下文嵌入模型"（而非词嵌入模型），像 bi-encoders（我们上次讨论过的）这样的模型在这里高度相关。

- [Bi-encoders 和 Cross-encoders 用于句子对相似度评分 — Part 1](https://www.dailydoseofds.com/bi-encoders-and-cross-encoders-for-sentence-pair-similarity-scoring-part-1/) — 深入探讨为什么 BERT 对句子相似度效果不佳，以及永远改变了这一任务的进展。

### 3) 将嵌入存储到向量数据库

这些嵌入随后被存储到向量数据库中：

![将嵌入存储到向量数据库](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-10.png)

这说明向量数据库充当了你的 RAG 应用的记忆——这正是我们存储所有额外知识的地方，用户的查询将基于这些知识来回答。

> 💡 向量数据库还随向量嵌入一起存储元数据和原始内容。

至此，我们的向量数据库已经创建并添加了信息。如果需要，还可以添加更多信息。

现在，我们进入查询步骤。

### 4) 用户输入查询

接下来，用户输入查询——一个代表他们所寻求信息的字符串。

![用户输入查询](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-11.png)

### 5) 嵌入查询

该查询使用与 Step 2 中嵌入分块时相同的嵌入模型被转换为向量。

![嵌入查询](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-12.png)

### 6) 检索相似分块

向量化的查询随后与数据库中的现有向量进行比较，以找到最相似的信息。

![检索相似分块](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-13.png)

向量数据库返回 $k$（一个预定义参数）个最相似的文档/分块（使用近似最近邻搜索）。

![Top-k 检索](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-14.png)

预期这些检索到的文档包含与查询相关的信息，为最终响应生成提供基础。

### 7) 重排序分块

检索后，选定的分块可能需要进一步精化，以确保最相关的信息被优先处理。

在这个重排序步骤中，一个更复杂的模型（通常是 cross-encoder，我们上周讨论过的）与查询一起评估初始检索分块列表，为每个分块分配一个相关性分数。

![重排序分块](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-15.png)

这个过程重新排列分块，使最相关的分块在响应生成中被优先处理。

不过，并非每个 RAG 应用都实现了这一步，通常它们只依赖步骤 6 中从向量数据库检索相关上下文时获得的相似度分数。

### 8) 生成最终响应

快完成了！

一旦最相关的分块被重排序，它们就被输入到 LLM 中。

该模型将用户的原始查询与检索到的分块在一个 prompt 模板中组合，以生成一个综合了选定文档信息的响应。

如下所示：

![生成最终响应](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/2024/11/image-16.png)

至此，我们对 RAG 系统端到端工作流程有了完整的理解。