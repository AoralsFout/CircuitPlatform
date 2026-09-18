#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace circuit {

class Simulation;

using ComponentId = std::uint64_t;
using ConnectionId = std::uint64_t;

enum class ComponentKind {
    Input,
    Output,
    AndGate,
    OrGate,
    NandGate,
    NorGate,
    XorGate,
    XnorGate,
    NotGate,
    Clock,
    DFlipFlop,
};

enum class PortDirection {
    Input,
    Output,
};

/**
 * 位区间：端口在其宿主元件的那条多位端口上占据的连续位范围，两端都包含。
 *
 * `msb >= lsb`，且声明它的端口位宽必须等于 `msb - lsb + 1`。位区间是 Port 自己的属性而不是
 * 挂在 Component 上的数据块，这样它跟着端口清单一起走，不需要另开一条传输通道。
 */
struct PortBitRange {
    std::uint32_t msb;
    std::uint32_t lsb;
};

struct Port {
    std::string name;
    PortDirection direction;
    /** 位宽，至少为 1。位宽为 1 且没有位区间的 Port 与引入位宽之前完全等价。 */
    std::uint32_t width{1};
    /** 可选的位区间；省略表示这个端口不落在某条宿主总线的某一段上。 */
    std::optional<PortBitRange> bitRange;
};

/** 单个端口声明不符合领域规则的原因。 */
enum class PortError {
    None,
    InvalidWidth,
    InvalidBitRange,
};

/**
 * 校验一份端口声明是否符合领域规则。
 * @param port 要校验的端口。
 * @return 位宽为 0 时返回 InvalidWidth；位区间的下界高于上界、或与位宽不一致时返回 InvalidBitRange。
 */
[[nodiscard]] PortError validatePort(const Port& port) noexcept;

struct Component {
    ComponentId id;
    ComponentKind kind;
    std::vector<Port> ports;
};

struct PortId {
    ComponentId component;
    std::string name;
};

struct Connection {
    ConnectionId id;
    PortId source;
    PortId target;
};

enum class ConnectionError {
    None,
    SourcePortNotFound,
    TargetPortNotFound,
    SourceMustBeOutput,
    TargetMustBeInput,
    InputAlreadyConnected,
    WidthMismatch,
};

struct ConnectionResult {
    std::optional<ConnectionId> id;
    ConnectionError error{ConnectionError::None};

    /**
     * 判断连接操作是否成功。
     * @return 成功时返回 true；失败时应通过 error 读取原因。
     */
    [[nodiscard]] bool succeeded() const noexcept {
        return id.has_value();
    }
};

class Circuit {
public:
    /**
     * 添加一个指定类型的元件，端口清单按内置定义建立。
     * @param kind 要添加的元件类型。
     * @return 新元件在当前电路中的唯一身份。
     */
    ComponentId addComponent(ComponentKind kind);

    /**
     * 添加一个指定类型的元件，并使用调用方给出的端口清单。
     *
     * 端口清单是位宽的唯一权威来源：调用方带着清单来时按清单建立，不带时由
     * `addComponent(ComponentKind)` 回退到内置定义。清单本身的合法性由调用方在调用前用
     * `validatePort` 逐项确认——Circuit 保存的是结构，不重复做协议层的校验。
     * @param kind 要添加的元件类型；只在行为分派时使用，不影响端口清单。
     * @param ports 该元件的端口清单。
     * @return 新元件在当前电路中的唯一身份。
     */
    ComponentId addComponent(ComponentKind kind, std::vector<Port> ports);

    /**
     * 用新的端口清单整体替换既有元件的端口清单。
     *
     * 整体替换而不是按端口增量修改：改宽与改位区间在用户眼里是同一件事，而一次合法的整体
     * 变更（例如拆线器重算其余分支的位区间）用按端口的形状表达不出来。Component 身份不变；
     * 与两端位宽仍然匹配的 Connection 身份也不变，不再匹配的那些按 `isDangling` 变成悬空。
     * @param id 要替换端口清单的元件身份。
     * @param ports 替换后的完整端口清单。
     * @return 元件存在并被替换时返回 true，否则返回 false。
     */
    bool setComponentPorts(ComponentId id, std::vector<Port> ports);

    /**
     * 按身份查询元件。
     * @param id 要查询的元件身份。
     * @return 元件副本；元件不存在时返回空值。
     */
    [[nodiscard]] std::optional<Component> component(ComponentId id) const;

    /**
     * 删除元件，但保留引用它的 Connection。
     * @param id 要删除的元件身份。
     * @return 元件存在并被删除时返回 true，否则返回 false。
     */
    bool removeComponent(ComponentId id);

    /**
     * 创建从输出端口到输入端口的连接。
     * @param source 连接的来源端口，必须是输出端口。
     * @param target 连接的目标端口，必须是输入端口且尚未连接。
     * @return 连接身份或具体的结构校验错误。
     */
    ConnectionResult addConnection(PortId source, PortId target);

    /**
     * 按身份删除连接。
     * @param id 要删除的连接身份。
     * @return 连接存在并被删除时返回 true，否则返回 false。
     */
    bool removeConnection(ConnectionId id);

    /**
     * 按身份查询连接。
     * @param id 要查询的连接身份。
     * @return 连接副本；连接不存在时返回空值。
     */
    [[nodiscard]] std::optional<Connection> connection(ConnectionId id) const;

    /**
     * 返回当前电路中保存的连接数量。
     * @return 有效连接和悬空连接的总数。
     */
    [[nodiscard]] std::size_t connectionCount() const noexcept;

    /**
     * 判断连接是否悬空。
     *
     * 悬空有两个条件：任一端点无法解析（端点所属元件被删除，或端口被端口清单替换掉了），
     * 或两端都能解析但声明的位宽不再相同。两者都落在领域里的同一个表达上——不参与仿真，
     * 但可以查看、删除或重新连接；不另造「失效连接」概念。
     * @param id 要检查的连接身份。
     * @return 连接存在且满足任一悬空条件时返回 true。
     */
    [[nodiscard]] bool isDangling(ConnectionId id) const noexcept;

    /**
     * 列出当前全部悬空连接的稳定顺序身份。
     * 改宽之后要把「哪些连接不再参与仿真」一次性告诉调用方，就需要能枚举而不只是逐个询问。
     * @return 按连接创建顺序排列的悬空连接身份。
     */
    [[nodiscard]] std::vector<ConnectionId> danglingConnections() const;

private:
    friend class Simulation;

    ComponentId nextComponentId_{1};
    ConnectionId nextConnectionId_{1};
    std::vector<Component> components_;
    std::vector<Connection> connections_;
};

}  // namespace circuit
