#include "circuit/circuit.hpp"

#include <algorithm>
#include <utility>

namespace circuit {
namespace {

// 集中定义每种元件的端口形状，确保创建元件和后续连接校验使用同一份规则。
// 内置定义里的端口位宽都是 1：逻辑门与 D Flip-Flop 都固定按 1 位工作，不会随输入自动变宽。
// 需要更宽的值时由用户显式用合线器构造，而不是让门自己变宽。
std::vector<Port> portsFor(ComponentKind kind) {
    const auto bit = [](std::string name, PortDirection direction) -> Port {
        return {.name = std::move(name), .direction = direction, .width = 1, .bitRange = std::nullopt};
    };

    switch (kind) {
    case ComponentKind::Input:
        return {bit("out", PortDirection::Output)};
    case ComponentKind::Output:
        return {bit("in", PortDirection::Input)};
    case ComponentKind::AndGate:
    case ComponentKind::OrGate:
    case ComponentKind::NandGate:
    case ComponentKind::NorGate:
    case ComponentKind::XorGate:
    case ComponentKind::XnorGate:
        return {
            bit("in1", PortDirection::Input),
            bit("in2", PortDirection::Input),
            bit("out", PortDirection::Output),
        };
    case ComponentKind::NotGate:
        return {
            bit("in", PortDirection::Input),
            bit("out", PortDirection::Output),
        };
    case ComponentKind::Clock:
        return {bit("out", PortDirection::Output)};
    case ComponentKind::DFlipFlop:
        return {
            bit("d", PortDirection::Input),
            bit("clock", PortDirection::Input),
            bit("q", PortDirection::Output),
        };
    }

    return {};
}

// 在当前元件集合中查找端口；找不到时返回空指针，供结构校验使用。
const Port* findPort(const std::vector<Component>& components, const PortId& portId) {
    const auto component = std::find_if(
        components.begin(), components.end(),
        [&portId](const Component& candidate) { return candidate.id == portId.component; });

    if (component == components.end()) {
        return nullptr;
    }

    const auto port = std::find_if(
        component->ports.begin(), component->ports.end(),
        [&portId](const Port& candidate) { return candidate.name == portId.name; });

    return port == component->ports.end() ? nullptr : &*port;
}

// 比较两个端口引用是否指向同一个元件端口。
bool samePort(const PortId& left, const PortId& right) {
    return left.component == right.component && left.name == right.name;
}

}  // namespace

// 生成单调递增的元件身份，并根据元件类型创建其端口。
ComponentId Circuit::addComponent(ComponentKind kind) {
    return addComponent(kind, portsFor(kind));
}

// 带端口清单的重载：清单由调用方提供，因此不再查内置定义。
ComponentId Circuit::addComponent(ComponentKind kind, std::vector<Port> ports) {
    const auto id = nextComponentId_++;
    components_.push_back({id, kind, std::move(ports)});
    return id;
}

// 整体替换端口清单。只换清单，元件身份与它保存的连接都不动——连接是否仍然有效由 isDangling 现算。
bool Circuit::setComponentPorts(ComponentId id, std::vector<Port> ports) {
    const auto found = std::find_if(
        components_.begin(), components_.end(),
        [id](const Component& component) { return component.id == id; });

    if (found == components_.end()) {
        return false;
    }

    found->ports = std::move(ports);
    return true;
}

// 校验端口声明本身的领域规则：位宽至少为 1，位区间必须落在自己的位宽内。
PortError validatePort(const Port& port) noexcept {
    if (port.width == 0) {
        return PortError::InvalidWidth;
    }

    if (!port.bitRange.has_value()) {
        return PortError::None;
    }

    const auto& range = *port.bitRange;
    if (range.msb < range.lsb) {
        return PortError::InvalidBitRange;
    }

    // 位区间决定分支端口的位宽，两者一致才是一次自洽的声明。
    return range.msb - range.lsb + 1 == port.width ? PortError::None : PortError::InvalidBitRange;
}

// 返回元件副本，避免调用者直接修改 Circuit 内部保存的结构。
std::optional<Component> Circuit::component(ComponentId id) const {
    const auto found = std::find_if(
        components_.begin(), components_.end(),
        [id](const Component& component) { return component.id == id; });

    if (found == components_.end()) {
        return std::nullopt;
    }

    return *found;
}

// 只移除元件本身；连接的独立生命周期由领域规则保证。
bool Circuit::removeComponent(ComponentId id) {
    const auto found = std::find_if(
        components_.begin(), components_.end(),
        [id](const Component& component) { return component.id == id; });

    if (found == components_.end()) {
        return false;
    }

    components_.erase(found);
    return true;
}

// 校验端点后保存连接；输入端的单来源规则在连接写入前检查。
ConnectionResult Circuit::addConnection(PortId source, PortId target) {
    const auto* sourcePort = findPort(components_, source);
    if (sourcePort == nullptr) {
        return {std::nullopt, ConnectionError::SourcePortNotFound};
    }

    const auto* targetPort = findPort(components_, target);
    if (targetPort == nullptr) {
        return {std::nullopt, ConnectionError::TargetPortNotFound};
    }

    if (sourcePort->direction != PortDirection::Output) {
        return {std::nullopt, ConnectionError::SourceMustBeOutput};
    }

    if (targetPort->direction != PortDirection::Input) {
        return {std::nullopt, ConnectionError::TargetMustBeInput};
    }

    // 位宽严格声明：两端不同就直接拒绝，不做零扩展、符号扩展或截断。需要换宽度时由用户
    // 显式用合线器构造目标宽度，而不是让连接静默丢位。
    if (sourcePort->width != targetPort->width) {
        return {std::nullopt, ConnectionError::WidthMismatch};
    }

    // 只有两端仍然有效的 Connection 才占用输入端；dangling Connection 可保留但不能阻塞重连。
    const auto targetAlreadyConnected = std::find_if(
        connections_.begin(), connections_.end(),
        [this, &target](const Connection& connection) {
            return !isDangling(connection.id) && samePort(connection.target, target);
        });
    if (targetAlreadyConnected != connections_.end()) {
        return {std::nullopt, ConnectionError::InputAlreadyConnected};
    }

    const auto id = nextConnectionId_++;
    connections_.push_back({id, std::move(source), std::move(target)});
    return {id, ConnectionError::None};
}

// 删除指定连接，不联动修改连接两端的元件。
bool Circuit::removeConnection(ConnectionId id) {
    const auto found = std::find_if(
        connections_.begin(), connections_.end(),
        [id](const Connection& candidate) { return candidate.id == id; });

    if (found == connections_.end()) {
        return false;
    }

    connections_.erase(found);
    return true;
}

// 返回连接副本，避免调用者绕过 Circuit 的规则直接修改连接。
std::optional<Connection> Circuit::connection(ConnectionId id) const {
    const auto found = std::find_if(
        connections_.begin(), connections_.end(),
        [id](const Connection& candidate) { return candidate.id == id; });

    if (found == connections_.end()) {
        return std::nullopt;
    }

    return *found;
}

// 连接数量包含有效连接和悬空连接，因为两者都仍然保存在 Circuit 中。
std::size_t Circuit::connectionCount() const noexcept {
    return connections_.size();
}

// 悬空状态由连接端点当前能否解析、以及两端位宽是否仍然相同现算得到，
// 而不是由独立的可变标志保存——改宽与改端口清单都不需要回头维护连接上的任何字段。
bool Circuit::isDangling(ConnectionId id) const noexcept {
    const auto found = std::find_if(
        connections_.begin(), connections_.end(),
        [id](const Connection& candidate) { return candidate.id == id; });

    if (found == connections_.end()) {
        return false;
    }

    const auto* sourcePort = findPort(components_, found->source);
    const auto* targetPort = findPort(components_, found->target);
    if (sourcePort == nullptr || targetPort == nullptr) {
        return true;
    }

    return sourcePort->width != targetPort->width;
}

// 按连接创建顺序枚举悬空连接；判定复用 isDangling，因此两个入口不会说出两套规则。
std::vector<ConnectionId> Circuit::danglingConnections() const {
    std::vector<ConnectionId> dangling;
    for (const auto& connection : connections_) {
        if (isDangling(connection.id)) {
            dangling.push_back(connection.id);
        }
    }
    return dangling;
}

}  // namespace circuit
