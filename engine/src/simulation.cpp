#include "circuit/simulation.hpp"

#include <algorithm>
#include <utility>

namespace circuit {
namespace {

// 在仿真快照中查找元件，供输入校验和端口解析复用。
const Component* findComponent(const std::vector<Component>& components, ComponentId id) {
    const auto found = std::find_if(
        components.begin(), components.end(),
        [id](const Component& component) { return component.id == id; });
    return found == components.end() ? nullptr : &*found;
}

// 根据元件身份和端口名称解析端口；失效引用由调用者解释为未知或悬空。
const Port* findPort(const std::vector<Component>& components, const PortId& portId) {
    const auto* component = findComponent(components, portId.component);
    if (component == nullptr) {
        return nullptr;
    }

    const auto found = std::find_if(
        component->ports.begin(), component->ports.end(),
        [&portId](const Port& port) { return port.name == portId.name; });
    return found == component->ports.end() ? nullptr : &*found;
}

// 比较两个端口身份，避免把端口的字符串和所属元件比较逻辑散落在各处。
bool samePort(const PortId& left, const PortId& right) {
    return left.component == right.component && left.name == right.name;
}

// NOT 门只翻转确定的 0 和 1，未知值仍然保持未知。
SignalValue invert(SignalValue value) {
    switch (value) {
    case SignalValue::Zero:
        return SignalValue::One;
    case SignalValue::One:
        return SignalValue::Zero;
    case SignalValue::Unknown:
        return SignalValue::Unknown;
    }

    return SignalValue::Unknown;
}

// AND 的三值逻辑：0 可以确定结果，只有没有 0 且全部为 1 时结果才是 1。
SignalValue andValue(SignalValue left, SignalValue right) {
    if (left == SignalValue::Zero || right == SignalValue::Zero) {
        return SignalValue::Zero;
    }
    if (left == SignalValue::One && right == SignalValue::One) {
        return SignalValue::One;
    }
    return SignalValue::Unknown;
}

// OR 的三值逻辑：1 可以确定结果，只有没有 1 且全部为 0 时结果才是 0。
SignalValue orValue(SignalValue left, SignalValue right) {
    if (left == SignalValue::One || right == SignalValue::One) {
        return SignalValue::One;
    }
    if (left == SignalValue::Zero && right == SignalValue::Zero) {
        return SignalValue::Zero;
    }
    return SignalValue::Unknown;
}

// XOR 在任一输入未知时无法确定结果；两个确定值相异时输出 1，否则输出 0。
SignalValue xorValue(SignalValue left, SignalValue right) {
    if (left == SignalValue::Unknown || right == SignalValue::Unknown) {
        return SignalValue::Unknown;
    }
    return left == right ? SignalValue::Zero : SignalValue::One;
}

// 集中分派所有二输入门，保持 settle 只负责读取输入和传播输出。
std::optional<SignalValue> evaluateBinaryGate(
    ComponentKind kind, SignalValue left, SignalValue right) {
    switch (kind) {
    case ComponentKind::AndGate:
        return andValue(left, right);
    case ComponentKind::OrGate:
        return orValue(left, right);
    case ComponentKind::NandGate:
        return invert(andValue(left, right));
    case ComponentKind::NorGate:
        return invert(orValue(left, right));
    case ComponentKind::XorGate:
        return xorValue(left, right);
    case ComponentKind::XnorGate:
        return invert(xorValue(left, right));
    default:
        return std::nullopt;
    }
}

}  // namespace

// 建立仿真快照，并将所有输出端初始化为 Unknown。
Simulation::Simulation(Circuit circuit) : circuit_(std::move(circuit)) {
    for (const auto& component : circuit_.components_) {
        for (const auto& port : component.ports) {
            if (port.direction == PortDirection::Output) {
                signals_.push_back({{component.id, port.name}, SignalValue::Unknown});
            }
        }
    }
}

// Input 是仿真外部的驱动源，因此只能通过元件身份修改它的输出值。
bool Simulation::setInput(ComponentId inputId, SignalValue value) {
    const auto* component = findComponent(circuit_.components_, inputId);
    if (component == nullptr || component->kind != ComponentKind::Input) {
        return false;
    }

    setOutputSignal({inputId, "out"}, value);
    return true;
}

// 反复计算 NOT 门，直到本轮没有输出变化或达到稳定化上限。
bool Simulation::settle() {
    const auto iterationLimit = circuit_.components_.size() + circuit_.connections_.size() + 1;

    for (std::size_t iteration = 0; iteration < iterationLimit; ++iteration) {
        bool changed = false;

        for (const auto& component : circuit_.components_) {
            if (component.kind == ComponentKind::NotGate) {
                const auto input = signal({component.id, "in"}).value_or(SignalValue::Unknown);
                changed = setOutputSignal({component.id, "out"}, invert(input)) || changed;
            } else {
                const auto first = signal({component.id, "in1"}).value_or(SignalValue::Unknown);
                const auto second = signal({component.id, "in2"}).value_or(SignalValue::Unknown);
                const auto output = evaluateBinaryGate(component.kind, first, second);
                if (output.has_value()) {
                    changed = setOutputSignal({component.id, "out"}, *output) || changed;
                }
            }
        }

        if (!changed) {
            return true;
        }
    }

    return false;
}

// 输出端直接读取保存值；输入端沿 Connection 读取来源输出值。
std::optional<SignalValue> Simulation::signal(PortId portId) const {
    const auto* port = findPort(circuit_.components_, portId);
    if (port == nullptr) {
        return std::nullopt;
    }

    if (port->direction == PortDirection::Output) {
        return outputSignal(portId);
    }

    const auto connection = std::find_if(
        circuit_.connections_.begin(), circuit_.connections_.end(),
        [&portId](const Connection& candidate) { return samePort(candidate.target, portId); });
    if (connection == circuit_.connections_.end()) {
        return SignalValue::Unknown;
    }

    const auto* sourcePort = findPort(circuit_.components_, connection->source);
    if (sourcePort == nullptr || sourcePort->direction != PortDirection::Output) {
        return SignalValue::Unknown;
    }

    return outputSignal(connection->source);
}

// 只更新已知的输出端，并用返回值告诉稳定化循环是否发生了变化。
bool Simulation::setOutputSignal(const PortId& portId, SignalValue value) {
    const auto found = std::find_if(
        signals_.begin(), signals_.end(),
        [&portId](const PortSignal& signal) { return samePort(signal.port, portId); });
    if (found == signals_.end()) {
        return false;
    }

    if (found->value == value) {
        return false;
    }

    found->value = value;
    return true;
}

// 读取输出端的当前值；不存在的内部状态按 Unknown 处理。
SignalValue Simulation::outputSignal(const PortId& portId) const {
    const auto found = std::find_if(
        signals_.begin(), signals_.end(),
        [&portId](const PortSignal& signal) { return samePort(signal.port, portId); });
    return found == signals_.end() ? SignalValue::Unknown : found->value;
}

}  // namespace circuit
