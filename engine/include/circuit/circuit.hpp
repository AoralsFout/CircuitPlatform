#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace circuit {

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

    [[nodiscard]] bool succeeded() const noexcept {
        return id.has_value();
    }
};

class Circuit {
public:
    ComponentId addComponent(ComponentKind kind);
    [[nodiscard]] std::optional<Component> component(ComponentId id) const;
    bool removeComponent(ComponentId id);
    ConnectionResult addConnection(PortId source, PortId target);
    bool removeConnection(ConnectionId id);
    [[nodiscard]] std::optional<Connection> connection(ConnectionId id) const;
    [[nodiscard]] std::size_t connectionCount() const noexcept;
    [[nodiscard]] bool isDangling(ConnectionId id) const noexcept;

private:
    ComponentId nextComponentId_{1};
    ConnectionId nextConnectionId_{1};
    std::vector<Component> components_;
    std::vector<Connection> connections_;
};

}  // namespace circuit
