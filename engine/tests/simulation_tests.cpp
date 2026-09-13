#include "circuit/simulation.hpp"

#include <cassert>

void evaluates_input_not_and_output() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({inputId, "out"}, {notId, "in"}).succeeded());
    assert(circuit.addConnection({notId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::Zero));
    assert(simulation.settle());

    const auto output = simulation.signal({outputId, "in"});
    assert(output.has_value());
    assert(*output == circuit::SignalValue::One);
}

void updates_the_output_when_the_input_changes() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({inputId, "out"}, {notId, "in"}).succeeded());
    assert(circuit.addConnection({notId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::Zero));
    assert(simulation.settle());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::One);

    assert(simulation.setInput(inputId, circuit::SignalValue::One));
    assert(simulation.settle());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::Zero);
}

void propagates_unknown_when_a_not_input_is_unconnected() {
    circuit::Circuit circuit;
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({notId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.settle());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::Unknown);
}

int main() {
    evaluates_input_not_and_output();
    updates_the_output_when_the_input_changes();
    propagates_unknown_when_a_not_input_is_unconnected();
    return 0;
}
