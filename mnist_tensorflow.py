import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
import numpy as np
import matplotlib.pyplot as plt

print("TensorFlow版本:", tf.__version__)

# 1. 加载MNIST数据集
(x_train, y_train), (x_test, y_test) = keras.datasets.mnist.load_data()

# 2. 数据预处理
x_train = x_train.astype("float32") / 255.0
x_test = x_test.astype("float32") / 255.0

# 3. 构建模型
model = keras.Sequential([
    layers.Input(shape=(28, 28)),
    layers.Reshape((28, 28, 1)),
    layers.Conv2D(32, kernel_size=(3, 3), activation="relu"),
    layers.MaxPooling2D(pool_size=(2, 2)),
    layers.Conv2D(64, kernel_size=(3, 3), activation="relu"),
    layers.MaxPooling2D(pool_size=(2, 2)),
    layers.Flatten(),
    layers.Dense(128, activation="relu"),
    layers.Dropout(0.5),
    layers.Dense(10, activation="softmax")
])

# 4. 编译模型
model.compile(
    optimizer='adam',
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy']
)

# 5. 训练模型
print("\n开始训练...")
history = model.fit(
    x_train, y_train,
    batch_size=128,
    epochs=5,
    validation_split=0.1,
    verbose=1
)

# 6. 评估模型
print("\n评估模型...")
test_loss, test_acc = model.evaluate(x_test, y_test, verbose=0)
print(f"测试集准确率: {test_acc:.4f}")

# 7. 保存模型
model.save('/Users/yuelongfang/Desktop/demo/learn/mnist_model.h5')
print(f"\n模型已保存到: /Users/yuelongfang/Desktop/demo/learn/mnist_model.h5")

# 8. 预测示例
predictions = model.predict(x_test[:5])
print("\n预测第1张图片:")
print(f"预测结果: {np.argmax(predictions[0])}")
print(f"真实标签: {y_test[0]}")

# 9. 可视化训练过程
plt.figure(figsize=(12, 4))

plt.subplot(1, 2, 1)
plt.plot(history.history['accuracy'], label='训练准确率')
plt.plot(history.history['val_accuracy'], label='验证准确率')
plt.title('模型准确率')
plt.xlabel('更新步数')
plt.ylabel('准确率')
plt.legend()

plt.subplot(1, 2, 2)
plt.plot(history.history['loss'], label='训练损失')
plt.plot(history.history['val_loss'], label='验证损失')
plt.title('模型损失')
plt.xlabel('更新步数')
plt.ylabel('损失')
plt.legend()

plt.tight_layout()
plt.savefig('/Users/yuelongfang/Desktop/demo/learn/training_history.png')
print(f"训练过程图已保存到: /Users/yuelongfang/Desktop/demo/learn/training_history.png")

print("\n项目完成! 所有文件已生成到 /Users/yuelongfang/Desktop/demo/learn/ 目录")