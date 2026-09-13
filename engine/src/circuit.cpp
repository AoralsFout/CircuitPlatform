#include "circuit/circuit.hpp"

#include <algorithm>
#include <utility>

namespace circuit {
namespace {

std::vector<Port> portsFor(ComponentKind kind) {
    switch (kind) {
    case ComponentKind::Input:
        return {{"out", PortDirection::Output}};
    case ComponentKind::Output:
        return {{"in", PortDirection::Input}};
    case ComponentKind::AndGate:
    case ComponentKind::OrGate:
        return {
            {"in1", PortDirection::Input},
            {"in2", PortDirection::Input},
            {"out", PortDirection::Output},
        };
    case ComponentKind::NotGate:
        return {
            {"in", PortDirection::Input},
            {"out", PortDirection::Output},
        };
    case ComponentKind::Clock:
        return {{"out", PortDirection::Output}};
    case ComponentKind::DFlipFlop:
        return {
            {"d", PortDirection::Input},
            {"clock", PortDirection::Input},
            {"q", PortDirection::Output},
        };
    }

    return {};
}

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

bool samePort(const PortId& left, const PortId& right) {
    return left.component == right.component && left.name == right.name;
}

}  // namespace

ComponentId Circuit::addComponent(ComponentKind kind) {
    const auto id = nextComponentId_++;
    components_.push_back({id, kind, portsFor(kind)});
    return id;
}

std::optional<Component> Circuit::component(ComponentId id) const {
    const auto found = std::find_if(
        components_.begin(), components_.end(),
        [id](const Component& component) { return component.id == id; });

    if (found == components_.end()) {
        return std::nullopt;
    }

    return *found;
}

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

    const auto targetAlreadyConnected = std::find_if(
        connections_.begin(), connections_.end(),
        [&target](const Connection& connection) { return samePort(connection.target, target); });
    if (targetAlreadyConnected != connections_.end()) {
        return {std::nullopt, ConnectionError::InputAlreadyConnected};
    }

    const auto id = nextConnectionId_++;
    connections_.push_back({id, std::move(source), std::move(target)});
    return {id, ConnectionError::None};
}

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

std::optional<Connection> Circuit::connection(ConnectionId id) const {
    const auto found = std::find_if(
        connections_.begin(), connections_.end(),
        [id](const Connection& candidate) { return candidate.id == id; });

    if (found == connections_.end()) {
        return std::nullopt;
    }

    return *found;
}

std::size_t Circuit::connectionCount() const noexcept {
    return connections_.size();
}

bool Circuit::isDangling(ConnectionId id) const noexcept {
    const auto found = std::find_if(
        connections_.begin(), connections_.end(),
        [id](const Connection& candidate) { return candidate.id == id; });

    if (found == connections_.end()) {
        return false;
    }

    return findPort(components_, found->source) == nullptr ||
           findPort(components_, found->target) == nullptr;
}

}  // namespace circuit
