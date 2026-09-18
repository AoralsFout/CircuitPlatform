#include "circuit/simulation.hpp"

#include <cassert>
#include <array>
#include <optional>

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

// 在输出快照里按端口查找信号；快照只覆盖输出端口，找不到时返回空值。
std::optional<circuit::SignalValue> snapshotValue(
    const circuit::Simulation& simulation, circuit::PortId portId) {
    for (const auto& signal : simulation.outputSignals()) {
        if (signal.port.component == portId.component && signal.port.name == portId.name) {
            return signal.value;
        }
    }
    return std::nullopt;
}

void initializes_the_clock_output_to_zero() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);

    circuit::Simulation simulation(circuit);

    // 初值必须是 0 而不是 X，否则第一次跳变是 X → 1，永远判不出上升沿。
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::Zero);
    assert(simulation.step() == 0);
}

void flips_the_clock_once_per_tick() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);

    circuit::Simulation simulation(circuit);

    assert(simulation.tick().succeeded());
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::One);
    assert(simulation.step() == 1);

    assert(simulation.tick().succeeded());
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::Zero);
    assert(simulation.step() == 2);
}

void keeps_the_clock_still_under_settle() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);

    circuit::Simulation simulation(circuit);
    assert(simulation.tick().succeeded());

    // settle 只做组合求值到稳定，不推进 tick，也不改变 Clock。
    assert(simulation.settle().succeeded());
    assert(simulation.settle().succeeded());
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::One);
    assert(simulation.step() == 1);
}

void drives_a_combinational_chain_from_the_clock() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({clockId, "out"}, {notId, "in"}).succeeded());
    assert(circuit.addConnection({notId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::One);

    // 第一次推进把 Clock 从 0 翻到 1，组合逻辑随即传播到 Output。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::Zero);
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::Zero);

    assert(simulation.tick().succeeded());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::One);
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::One);
}

void snapshots_every_output_port_after_a_tick() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({clockId, "out"}, {notId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    const auto before = simulation.outputSignals().size();
    // 只有输出端口进入快照：Clock 的 out、NOT 的 out、D Flip-Flop 的 q，不含 Output 的 in。
    assert(before == 3);

    assert(simulation.tick().succeeded());
    const auto after = simulation.outputSignals().size();
    assert(after == before);
    assert(snapshotValue(simulation, {clockId, "out"}) == circuit::SignalValue::One);
    assert(snapshotValue(simulation, {notId, "out"}) == circuit::SignalValue::Zero);
    assert(snapshotValue(simulation, {flipFlopId, "q"}) == circuit::SignalValue::Unknown);
    assert(!snapshotValue(simulation, {outputId, "in"}).has_value());
}

void samples_d_on_the_clock_rising_edge() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({inputId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::One));

    // 第一次有效上升沿之前 q 是 X：表示还没有采过样，而不是保存了 0。
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::Unknown);

    // 第 1 次推进：Clock 从 0 翻到 1，是上升沿，把 d = 1 采样进 q。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);

    // 第 2 次推进：Clock 从 1 翻到 0，是下降沿，d 变了也不采样。
    assert(simulation.setInput(inputId, circuit::SignalValue::Zero));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);

    // 第 3 次推进：又一个上升沿，这次把 d = 0 采样进 q。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::Zero);
}

void samples_when_an_input_drives_the_clock_port() {
    circuit::Circuit circuit;
    const auto clockInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto dataInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockInputId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({dataInputId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataInputId, circuit::SignalValue::One));

    // Input 的初值是 X，把它置 0 只是 X → 0，不构成上升沿。
    assert(simulation.setInput(clockInputId, circuit::SignalValue::Zero));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::Unknown);

    // 0 → 1 是上升沿：时钟来源是 Input 而不是 Clock 元件，判定完全一样。
    assert(simulation.setInput(clockInputId, circuit::SignalValue::One));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);

    // 下降沿上改变 d，q 按住不动。
    assert(simulation.setInput(dataInputId, circuit::SignalValue::Zero));
    assert(simulation.setInput(clockInputId, circuit::SignalValue::Zero));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);

    // 下一次上升沿采样新的 d。
    assert(simulation.setInput(clockInputId, circuit::SignalValue::One));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::Zero);
}

void samples_through_a_gated_clock() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto enableId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto andId = circuit.addComponent(circuit::ComponentKind::AndGate);
    const auto dataId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockId, "out"}, {andId, "in1"}).succeeded());
    assert(circuit.addConnection({enableId, "out"}, {andId, "in2"}).succeeded());
    assert(circuit.addConnection({andId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({dataId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataId, circuit::SignalValue::One));
    assert(simulation.setInput(enableId, circuit::SignalValue::One));
    assert(simulation.settle().succeeded());

    // 门控打开：Clock 翻到 1 时 AND 的输出从 0 变到 1，clock 端口上就是一个上升沿。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);

    // 门控关闭：AND 的输出恒为 0，Clock 继续翻转也构不成上升沿。
    assert(simulation.setInput(dataId, circuit::SignalValue::Zero));
    assert(simulation.setInput(enableId, circuit::SignalValue::Zero));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);

    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);
}

void does_not_sample_when_the_clock_leaves_an_unknown_level() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto orId = circuit.addComponent(circuit::ComponentKind::OrGate);
    const auto dataId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    // OR 的第二个输入不连接，永远读到 X：or(clock, X) 在 clock 为 1 时是 1，为 0 时是 X。
    assert(circuit.addConnection({clockId, "out"}, {orId, "in1"}).succeeded());
    assert(circuit.addConnection({orId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({dataId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataId, circuit::SignalValue::One));

    // 第一次推进：clock 端口的前值是 X，求值稳定后变成 1。X → 1 不是可靠的上升沿，
    // 因为上一拍可能本来就是 1，所以不采样。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({orId, "out"}) == circuit::SignalValue::One);
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::Unknown);

    // 之后每一拍都在 X 与 1 之间来回，永远凑不出 0 → 1。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::Unknown);
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::Unknown);
}

void leaves_a_flip_flop_without_a_clock_untouched() {
    circuit::Circuit circuit;
    const auto dataId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({dataId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataId, circuit::SignalValue::One));

    // 没有连接 clock，端口一直读到 X，构不成上升沿：这是结构问题而不是错误，引擎不报错。
    for (int tick = 0; tick < 3; ++tick) {
        assert(simulation.tick().succeeded());
        assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::Unknown);
    }
}

void keeps_q_under_settle() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto dataId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({dataId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataId, circuit::SignalValue::One));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);

    // settle 只做组合求值到稳定：不推进 tick，也不改变 q。
    assert(simulation.setInput(dataId, circuit::SignalValue::Zero));
    assert(simulation.settle().succeeded());
    assert(simulation.settle().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::One);
    assert(simulation.step() == 1);
}

void rejects_a_tick_that_cannot_settle() {
    circuit::Circuit circuit;
    const auto firstNotId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto secondNotId = circuit.addComponent(circuit::ComponentKind::NotGate);

    assert(circuit.addConnection({firstNotId, "out"}, {secondNotId, "in"}).succeeded());
    assert(circuit.addConnection({secondNotId, "out"}, {firstNotId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    const auto result = simulation.tick();
    assert(!result.succeeded());
    assert(result.error == circuit::SimulationError::CombinationalLoop);
    assert(simulation.step() == 0);
}

int main() {
    initializes_the_clock_output_to_zero();
    flips_the_clock_once_per_tick();
    keeps_the_clock_still_under_settle();
    drives_a_combinational_chain_from_the_clock();
    snapshots_every_output_port_after_a_tick();
    samples_d_on_the_clock_rising_edge();
    samples_when_an_input_drives_the_clock_port();
    samples_through_a_gated_clock();
    does_not_sample_when_the_clock_leaves_an_unknown_level();
    leaves_a_flip_flop_without_a_clock_untouched();
    keeps_q_under_settle();
    rejects_a_tick_that_cannot_settle();
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
