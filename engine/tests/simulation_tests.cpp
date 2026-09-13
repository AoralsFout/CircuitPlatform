#include "circuit/simulation.hpp"

#include <cassert>
#include <array>

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

void evaluates_and_truth_table() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto andId = circuit.addComponent(circuit::ComponentKind::AndGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({firstInputId, "out"}, {andId, "in1"}).succeeded());
    assert(circuit.addConnection({secondInputId, "out"}, {andId, "in2"}).succeeded());
    assert(circuit.addConnection({andId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    struct TestCase {
        circuit::SignalValue first;
        circuit::SignalValue second;
        circuit::SignalValue expected;
    };
    const std::array cases{
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Zero, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::One, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Zero, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::One, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Unknown, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Unknown, circuit::SignalValue::One, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Unknown, circuit::SignalValue::Zero},
    };

    for (const auto& testCase : cases) {
        assert(simulation.setInput(firstInputId, testCase.first));
        assert(simulation.setInput(secondInputId, testCase.second));
        assert(simulation.settle());
        assert(simulation.signal({outputId, "in"}) == testCase.expected);
    }
}

void evaluates_or_truth_table() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto orId = circuit.addComponent(circuit::ComponentKind::OrGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({firstInputId, "out"}, {orId, "in1"}).succeeded());
    assert(circuit.addConnection({secondInputId, "out"}, {orId, "in2"}).succeeded());
    assert(circuit.addConnection({orId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    struct TestCase {
        circuit::SignalValue first;
        circuit::SignalValue second;
        circuit::SignalValue expected;
    };
    const std::array cases{
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Zero, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::One, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Zero, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::One, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Unknown, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Unknown, circuit::SignalValue::Zero, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Unknown, circuit::SignalValue::One},
    };

    for (const auto& testCase : cases) {
        assert(simulation.setInput(firstInputId, testCase.first));
        assert(simulation.setInput(secondInputId, testCase.second));
        assert(simulation.settle());
        assert(simulation.signal({outputId, "in"}) == testCase.expected);
    }
}

int main() {
    evaluates_input_not_and_output();
    updates_the_output_when_the_input_changes();
    propagates_unknown_when_a_not_input_is_unconnected();
    evaluates_and_truth_table();
    evaluates_or_truth_table();
    return 0;
}
