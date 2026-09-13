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
    assert(simulation.settle().succeeded());

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
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::One);

    assert(simulation.setInput(inputId, circuit::SignalValue::One));
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::Zero);
}

void propagates_unknown_when_a_not_input_is_unconnected() {
    circuit::Circuit circuit;
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({notId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.settle().succeeded());
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
        assert(simulation.settle().succeeded());
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
        assert(simulation.settle().succeeded());
        assert(simulation.signal({outputId, "in"}) == testCase.expected);
    }
}

void evaluates_nand_truth_table() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto nandId = circuit.addComponent(circuit::ComponentKind::NandGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({firstInputId, "out"}, {nandId, "in1"}).succeeded());
    assert(circuit.addConnection({secondInputId, "out"}, {nandId, "in2"}).succeeded());
    assert(circuit.addConnection({nandId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    struct TestCase {
        circuit::SignalValue first;
        circuit::SignalValue second;
        circuit::SignalValue expected;
    };
    const std::array cases{
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Zero, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::One, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Zero, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::One, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Unknown, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Unknown, circuit::SignalValue::One, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Unknown, circuit::SignalValue::One},
    };

    for (const auto& testCase : cases) {
        assert(simulation.setInput(firstInputId, testCase.first));
        assert(simulation.setInput(secondInputId, testCase.second));
        assert(simulation.settle().succeeded());
        assert(simulation.signal({outputId, "in"}) == testCase.expected);
    }
}

void evaluates_nor_truth_table() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto norId = circuit.addComponent(circuit::ComponentKind::NorGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({firstInputId, "out"}, {norId, "in1"}).succeeded());
    assert(circuit.addConnection({secondInputId, "out"}, {norId, "in2"}).succeeded());
    assert(circuit.addConnection({norId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    struct TestCase {
        circuit::SignalValue first;
        circuit::SignalValue second;
        circuit::SignalValue expected;
    };
    const std::array cases{
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Zero, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::One, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Zero, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::One, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Unknown, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Unknown, circuit::SignalValue::Zero, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Unknown, circuit::SignalValue::Zero},
    };

    for (const auto& testCase : cases) {
        assert(simulation.setInput(firstInputId, testCase.first));
        assert(simulation.setInput(secondInputId, testCase.second));
        assert(simulation.settle().succeeded());
        assert(simulation.signal({outputId, "in"}) == testCase.expected);
    }
}

void evaluates_xor_truth_table() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto xorId = circuit.addComponent(circuit::ComponentKind::XorGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({firstInputId, "out"}, {xorId, "in1"}).succeeded());
    assert(circuit.addConnection({secondInputId, "out"}, {xorId, "in2"}).succeeded());
    assert(circuit.addConnection({xorId, "out"}, {outputId, "in"}).succeeded());

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
        TestCase{circuit::SignalValue::One, circuit::SignalValue::One, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Unknown, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Unknown, circuit::SignalValue::One, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Unknown, circuit::SignalValue::Unknown, circuit::SignalValue::Unknown},
    };

    for (const auto& testCase : cases) {
        assert(simulation.setInput(firstInputId, testCase.first));
        assert(simulation.setInput(secondInputId, testCase.second));
        assert(simulation.settle().succeeded());
        assert(simulation.signal({outputId, "in"}) == testCase.expected);
    }
}

void evaluates_xnor_truth_table() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto xnorId = circuit.addComponent(circuit::ComponentKind::XnorGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({firstInputId, "out"}, {xnorId, "in1"}).succeeded());
    assert(circuit.addConnection({secondInputId, "out"}, {xnorId, "in2"}).succeeded());
    assert(circuit.addConnection({xnorId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    struct TestCase {
        circuit::SignalValue first;
        circuit::SignalValue second;
        circuit::SignalValue expected;
    };
    const std::array cases{
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Zero, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::One, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::Zero, circuit::SignalValue::Zero},
        TestCase{circuit::SignalValue::One, circuit::SignalValue::One, circuit::SignalValue::One},
        TestCase{circuit::SignalValue::Zero, circuit::SignalValue::Unknown, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Unknown, circuit::SignalValue::One, circuit::SignalValue::Unknown},
        TestCase{circuit::SignalValue::Unknown, circuit::SignalValue::Unknown, circuit::SignalValue::Unknown},
    };

    for (const auto& testCase : cases) {
        assert(simulation.setInput(firstInputId, testCase.first));
        assert(simulation.setInput(secondInputId, testCase.second));
        assert(simulation.settle().succeeded());
        assert(simulation.signal({outputId, "in"}) == testCase.expected);
    }
}

void evaluates_a_multilevel_not_chain_independently_of_creation_order() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondNotId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto firstNotId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({inputId, "out"}, {firstNotId, "in"}).succeeded());
    assert(circuit.addConnection({firstNotId, "out"}, {secondNotId, "in"}).succeeded());
    assert(circuit.addConnection({secondNotId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::Zero));
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::Zero);
}

void rejects_a_combinational_feedback_loop() {
    circuit::Circuit circuit;
    const auto firstNotId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto secondNotId = circuit.addComponent(circuit::ComponentKind::NotGate);

    assert(circuit.addConnection({firstNotId, "out"}, {secondNotId, "in"}).succeeded());
    assert(circuit.addConnection({secondNotId, "out"}, {firstNotId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    const auto result = simulation.settle();
    assert(!result.succeeded());
    assert(result.error == circuit::SimulationError::CombinationalLoop);
}

int main() {
    evaluates_input_not_and_output();
    updates_the_output_when_the_input_changes();
    propagates_unknown_when_a_not_input_is_unconnected();
    evaluates_and_truth_table();
    evaluates_or_truth_table();
    evaluates_nand_truth_table();
    evaluates_nor_truth_table();
    evaluates_xor_truth_table();
    evaluates_xnor_truth_table();
    evaluates_a_multilevel_not_chain_independently_of_creation_order();
    rejects_a_combinational_feedback_loop();
    return 0;
}
