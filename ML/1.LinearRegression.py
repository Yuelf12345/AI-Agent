# 线性回归实现教程
# 目标：找到最佳拟合直线 y = w * x + b

import numpy as np
# import matplotlib.pyplot as plt

# ============================================
# 第一步：准备训练数据
# ============================================
# 创建一个简单的线性关系数据集
# 假设真实关系是: y = 2x + 3 (加上一些随机噪声)
np.random.seed(42)  # 固定随机种子，保证结果可复现

# 生成 100 个训练样本
X = np.random.rand(100) * 10  # 输入: 0-10 之间的随机数
Y = 2 * X + 3 + np.random.randn(100) * 2  # 输出: 2x+3 加上噪声

print(f"数据集大小: {len(X)} 个样本")
print(f"X 范围: [{X.min():.2f}, {X.max():.2f}]")
print(f"Y 范围: [{Y.min():.2f}, {Y.max():.2f}]")

# ============================================
# 第二步：初始化参数
# ============================================
w = 0.0  # 权重(斜率)初始化为 0
b = 0.0  # 偏置(截距)初始化为 0
learning_rate = 0.01  # 学习率：控制参数更新的步长
iterations = 4000  # 训练迭代次数

print(f"\n初始参数: w={w}, b={b}")
print(f"学习率: {learning_rate}, 迭代次数: {iterations}")

# ============================================
# 第三步：定义损失函数 (Cost Function)
# ============================================
def compute_cost(X, Y, w, b):
    """
    计算均方误差损失
    
    公式: J(w,b) = 1/(2m) × Σ(预测值 - 真实值)²
    
    参数:
        X: 输入特征
        Y: 真实标签
        w: 权重
        b: 偏置
    
    返回:
        cost: 损失值
    """
    m = len(X)  # 样本数量
    predictions = w * X + b  # 预测值 = w*x + b
    errors = predictions - Y  # 误差 = 预测值 - 真实值
    cost = np.sum(errors ** 2) / (2 * m)  # 均方误差
    return cost # np.sum((( w * X + b) - Y ) ** 2) / (2 * m)

# ============================================
# 第四步：计算梯度 (Gradient)
# ============================================
def compute_gradient(X, Y, w, b):
    """
    计算损失函数对 w 和 b 的梯度(偏导数)
    
    公式:
        ∂J/∂w = 1/m × Σ(预测值 - 真实值) × x
        ∂J/∂b = 1/m × Σ(预测值 - 真实值)
    
    参数:
        X: 输入特征
        Y: 真实标签
        w: 当前权重
        b: 当前偏置
    
    返回:
        dw: w 的梯度
        db: b 的梯度
    """
    m = len(X)  # 样本数量
    predictions = w * X + b  # 预测值
    errors = predictions - Y  # 误差
    
    # 计算梯度(注意这里是向量化计算，比循环快得多)
    dw = np.sum(errors * X) / m  # w 的梯度
    db = np.sum(errors) / m      # b 的梯度
    
    return dw, db

# ============================================
# 第五步：梯度下降训练
# ============================================
print("\n开始训练...")
cost_history = []  # 记录每次迭代的损失值

for i in range(iterations):
    # 1. 计算当前损失
    cost = compute_cost(X, Y, w, b)
    cost_history.append(cost)

    # 2. 计算梯度
    dw, db = compute_gradient(X, Y, w, b)

    # 3. 更新参数(梯度下降)
    w = w - learning_rate * dw  # w 沿着梯度反方向移动
    b = b - learning_rate * db  # b 沿着梯度反方向移动
    
    # 每 100 次迭代打印一次进度
    if (i + 1) % 100 == 0:
        print(f"迭代 {i+1}/{iterations} - 损失: {cost:.4f} - w: {w:.4f}, b: {b:.4f}")

# ============================================
# 第六步：输出最终结果
# ============================================
print(f"\n训练完成!")
print(f"最终参数: w={w:.4f}, b={b:.4f}")
print(f"真实参数: w=2.0000, b=3.0000 (用于生成数据的参数)")
print(f"最终损失: {cost_history[-1]:.4f}")

# ============================================
# # 第七步：可视化结果
# # ============================================
# plt.figure(figsize=(14, 5))

# # 子图1: 原始数据 + 拟合直线
# plt.subplot(1, 2, 1)
# plt.scatter(X, Y, alpha=0.5, label='训练数据')
# plt.plot(X, w * X + b, 'r-', linewidth=2, label=f'拟合直线: y={w:.2f}x+{b:.2f}')
# plt.plot(X, 2 * X + 3, 'g--', linewidth=2, label='真实直线: y=2x+3')
# plt.xlabel('X')
# plt.ylabel('Y')
# plt.title('线性回归拟合结果')
# plt.legend()
# plt.grid(True, alpha=0.3)

# # 子图2: 损失曲线
# plt.subplot(1, 2, 2)
# plt.plot(cost_history, linewidth=2)
# plt.xlabel('迭代次数')
# plt.ylabel('损失值 (MSE)')
# plt.title('训练过程中的损失变化')
# plt.grid(True, alpha=0.3)

# plt.tight_layout()
# plt.show()

# ============================================
# 第八步：测试预测
# ============================================
print("\n测试预测:")
test_inputs = [0, 5, 10]
for x_test in test_inputs:
    y_pred = w * x_test + b
    y_true = 2 * x_test + 3  # 真实值
    print(f"输入 x={x_test:2.0f} -> 预测 y={y_pred:.2f}, 真实 y={y_true:.2f}, 误差={abs(y_pred-y_true):.2f}")