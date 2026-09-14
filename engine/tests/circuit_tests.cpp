#include "circuit/circuit.hpp"

#include <cassert>

void adds_an_and_gate_with_two_inputs_and_one_output() {
    circuit::Circuit circuit;
    const auto gateId = circuit.addComponent(circuit::ComponentKind::AndGate);
    const auto gate = circuit.component(gateId);

    assert(gate.has_value());
    assert(gate->ports.size() == 3);
    assert(gate->ports[0].direction == circuit::PortDirection::Input);
    assert(gate->ports[1].direction == circuit::PortDirection::Input);
    assert(gate->ports[2].direction == circuit::PortDirection::Output);
}

void adds_a_connection_between_valid_ports() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    const auto result = circuit.addConnection(
        {inputId, "out"},
        {outputId, "in"});

    assert(result.succeeded());
    assert(result.id.has_value());
    assert(circuit.connectionCount() == 1);

    const auto connection = circuit.connection(*result.id);
    assert(connection.has_value());
    assert(connection->source.component == inputId);
    assert(connection->target.component == outputId);
}

void deleting_a_component_leaves_a_dangling_connection() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto result = circuit.addConnection(
        {inputId, "out"},
        {outputId, "in"});

    assert(result.succeeded());
    assert(circuit.removeComponent(inputId));
    assert(!circuit.component(inputId).has_value());
    assert(circuit.connectionCount() == 1);
    assert(circuit.isDangling(*result.id));
}

void dangling_source_does_not_block_reconnecting_the_live_input() {
    circuit::Circuit circuit;
    const auto deletedInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto replacementInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto oldConnection = circuit.addConnection(
        {deletedInputId, "out"},
        {outputId, "in"});

    assert(oldConnection.succeeded());
    assert(circuit.removeComponent(deletedInputId));
    assert(circuit.isDangling(*oldConnection.id));

    const auto replacementConnection = circuit.addConnection(
        {replacementInputId, "out"},
        {outputId, "in"});

    assert(replacementConnection.succeeded());
    assert(circuit.connectionCount() == 2);
    assert(circuit.isDangling(*oldConnection.id));
    assert(!circuit.isDangling(*replacementConnection.id));
}

void dangling_target_is_retained_without_affecting_live_connections() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto deletedOutputId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto replacementOutputId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto oldConnection = circuit.addConnection(
        {inputId, "out"},
        {deletedOutputId, "in"});

    assert(oldConnection.succeeded());
    assert(circuit.removeComponent(deletedOutputId));
    assert(circuit.connectionCount() == 1);
    assert(circuit.isDangling(*oldConnection.id));

    const auto replacementConnection = circuit.addConnection(
        {inputId, "out"},
        {replacementOutputId, "in"});

    assert(replacementConnection.succeeded());
    assert(!circuit.isDangling(*replacementConnection.id));
    assert(circuit.isDangling(*oldConnection.id));
}

void deleting_a_connection_keeps_both_components() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto result = circuit.addConnection(
        {inputId, "out"},
        {outputId, "in"});

    assert(result.succeeded());
    assert(circuit.removeConnection(*result.id));
    assert(circuit.connectionCount() == 0);
    assert(circuit.component(inputId).has_value());
    assert(circuit.component(outputId).has_value());
}

void rejects_a_second_source_for_an_input_port() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    const auto first = circuit.addConnection(
        {firstInputId, "out"},
        {outputId, "in"});
    const auto second = circuit.addConnection(
        {secondInputId, "out"},
        {outputId, "in"});

    assert(first.succeeded());
    assert(!second.succeeded());
    assert(second.error == circuit::ConnectionError::InputAlreadyConnected);
    assert(circuit.connectionCount() == 1);
}

void allows_one_output_to_fan_out_to_multiple_inputs() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto firstOutputId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto secondOutputId = circuit.addComponent(circuit::ComponentKind::Output);

    const auto first = circuit.addConnection(
        {inputId, "out"},
        {firstOutputId, "in"});
    const auto second = circuit.addConnection(
        {inputId, "out"},
        {secondOutputId, "in"});

    assert(first.succeeded());
    assert(second.succeeded());
    assert(circuit.connectionCount() == 2);
}

void rejects_connections_with_invalid_port_directions() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto firstOutputId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto secondOutputId = circuit.addComponent(circuit::ComponentKind::Output);

    const auto inputToInput = circuit.addConnection(
        {firstInputId, "out"},
        {secondInputId, "out"});
    const auto outputToOutput = circuit.addConnection(
        {firstOutputId, "in"},
        {secondOutputId, "in"});

    assert(!inputToInput.succeeded());
    assert(inputToInput.error == circuit::ConnectionError::TargetMustBeInput);
    assert(!outputToOutput.succeeded());
    assert(outputToOutput.error == circuit::ConnectionError::SourceMustBeOutput);
    assert(circuit.connectionCount() == 0);
}

int main() {
    adds_an_and_gate_with_two_inputs_and_one_output();
    adds_a_connection_between_valid_ports();
    deleting_a_component_leaves_a_dangling_connection();
    dangling_source_does_not_block_reconnecting_the_live_input();
    dangling_target_is_retained_without_affecting_live_connections();
    deleting_a_connection_keeps_both_components();
    rejects_a_second_source_for_an_input_port();
    allows_one_output_to_fan_out_to_multiple_inputs();
    rejects_connections_with_invalid_port_directions();
    return 0;
}
