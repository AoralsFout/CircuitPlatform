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
    NotGate,
    Clock,
    DFlipFlop,
};

enum class PortDirection {
    Input,
    Output,
};

struct Port {
    std::string name;
    PortDirection direction;
};

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
     * 添加一个指定类型的元件。
     * @param kind 要添加的元件类型。
     * @return 新元件在当前电路中的唯一身份。
     */
    ComponentId addComponent(ComponentKind kind);

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
     * 判断连接是否因任一端点所属元件已被删除而悬空。
     * @param id 要检查的连接身份。
     * @return 连接存在且至少一个端点无法解析时返回 true。
     */
    [[nodiscard]] bool isDangling(ConnectionId id) const noexcept;

private:
    friend class Simulation;

    ComponentId nextComponentId_{1};
    ConnectionId nextConnectionId_{1};
    std::vector<Component> components_;
    std::vector<Connection> connections_;
};

}  // namespace circuit
