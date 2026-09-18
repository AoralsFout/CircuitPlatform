#include "circuit/simulation.hpp"

#include <cassert>
#include <array>
#include <optional>
#include <string>

void evaluates_input_not_and_output() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({inputId, "out"}, {notId, "in"}).succeeded());
    assert(circuit.addConnection({notId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::zero()));
    assert(simulation.settle().succeeded());

    const auto output = simulation.signal({outputId, "in"});
    assert(output.has_value());
    assert(*output == circuit::SignalValue::one());
}

void updates_the_output_when_the_input_changes() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({inputId, "out"}, {notId, "in"}).succeeded());
    assert(circuit.addConnection({notId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::zero()));
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::one());

    assert(simulation.setInput(inputId, circuit::SignalValue::one()));
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::zero());
}

void propagates_unknown_when_a_not_input_is_unconnected() {
    circuit::Circuit circuit;
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({notId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::unknown());
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
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::zero(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::one(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::zero(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::one(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::unknown(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::unknown(), circuit::SignalValue::one(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::unknown(), circuit::SignalValue::zero()},
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
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::zero(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::one(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::zero(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::one(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::unknown(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::unknown(), circuit::SignalValue::zero(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::unknown(), circuit::SignalValue::one()},
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
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::zero(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::one(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::zero(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::one(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::unknown(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::unknown(), circuit::SignalValue::one(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::unknown(), circuit::SignalValue::one()},
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
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::zero(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::one(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::zero(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::one(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::unknown(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::unknown(), circuit::SignalValue::zero(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::unknown(), circuit::SignalValue::zero()},
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
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::zero(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::one(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::zero(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::one(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::unknown(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::unknown(), circuit::SignalValue::one(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::unknown(), circuit::SignalValue::unknown(), circuit::SignalValue::unknown()},
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
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::zero(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::one(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::zero(), circuit::SignalValue::zero()},
        TestCase{circuit::SignalValue::one(), circuit::SignalValue::one(), circuit::SignalValue::one()},
        TestCase{circuit::SignalValue::zero(), circuit::SignalValue::unknown(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::unknown(), circuit::SignalValue::one(), circuit::SignalValue::unknown()},
        TestCase{circuit::SignalValue::unknown(), circuit::SignalValue::unknown(), circuit::SignalValue::unknown()},
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
    assert(simulation.setInput(inputId, circuit::SignalValue::zero()));
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::zero());
}

// 相等是逐位比较，长度也参与比较。这条语义是 `settle` 定点迭代唯一的收敛判据：
// 任何近似（例如把 X 当通配、或只比第一位）都会让迭代在还没稳定时判定「没有变化」。
void compares_signal_values_bit_by_bit() {
    const auto multiBit = circuit::SignalValue::fromBits("1X0");
    assert(multiBit.bits() == "1X0");
    assert(multiBit.width() == 3);
    assert(multiBit == circuit::SignalValue::fromBits("1X0"));

    // 只差一位就不相等。
    assert(multiBit != circuit::SignalValue::fromBits("1X1"));
    // X 不是通配：`1X0` 与 `110` 是两个不同的值。
    assert(multiBit != circuit::SignalValue::fromBits("110"));
    // 每一位都是 0 也不等于少一位的 0。
    assert(circuit::SignalValue::zero() != circuit::SignalValue::fromBits("00"));
    assert(circuit::SignalValue::one() != circuit::SignalValue::fromBits("11"));
    assert(circuit::SignalValue::unknown(2) == circuit::SignalValue::fromBits("XX"));
    assert(circuit::SignalValue::unknown() == circuit::SignalValue::unknown(1));
}

/**
 * 用两个 Input 驱动一个二输入门，求值到稳定后返回它的输出值。
 * 端口位宽还是 1（位宽是下一票的事），因此这里的多位值直接构造：值层已经逐位化，
 * 只是现有的所有端口都恰好是 1 位，看不出来。
 */
circuit::SignalValue gateOutput(
    circuit::ComponentKind kind, const std::string& first, const std::string& second) {
    circuit::Circuit circuit;
    const auto firstId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto gateId = circuit.addComponent(kind);
    assert(circuit.addConnection({firstId, "out"}, {gateId, "in1"}).succeeded());
    assert(circuit.addConnection({secondId, "out"}, {gateId, "in2"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(firstId, circuit::SignalValue::fromBits(first)));
    assert(simulation.setInput(secondId, circuit::SignalValue::fromBits(second)));
    assert(simulation.settle().succeeded());
    const auto output = simulation.signal({gateId, "out"});
    assert(output.has_value());
    return *output;
}

// 四位版的三值真值表：每一位只由两个输入的同一位置决定，X 只让它自己那一位未知。
void applies_the_gate_primitives_bit_by_bit() {
    assert(gateOutput(circuit::ComponentKind::AndGate, "1X10", "10X1") ==
           circuit::SignalValue::fromBits("10X0"));
    assert(gateOutput(circuit::ComponentKind::OrGate, "0X01", "10X0") ==
           circuit::SignalValue::fromBits("1XX1"));
    assert(gateOutput(circuit::ComponentKind::XorGate, "1100", "1X01") ==
           circuit::SignalValue::fromBits("0X01"));
    // NAND 与 NOR 就是逐位取反，未知位同样保持未知。
    assert(gateOutput(circuit::ComponentKind::NandGate, "1X10", "10X1") ==
           circuit::SignalValue::fromBits("01X1"));
    assert(gateOutput(circuit::ComponentKind::NorGate, "0X01", "10X0") ==
           circuit::SignalValue::fromBits("0XX0"));
    assert(gateOutput(circuit::ComponentKind::XnorGate, "1100", "1X01") ==
           circuit::SignalValue::fromBits("1X10"));

    // 位宽不一致是结构错误：产生它的 Connection 会被位宽校验挡住（下一票）。这里退回整值未知，
    // 而不是静默给出一个长度对不上的结果。
    assert(gateOutput(circuit::ComponentKind::AndGate, "11", "0") ==
           circuit::SignalValue::unknown(2));
}

// 逐位化最直接的后果：NOT 门只翻转能确定的位，未知位不影响其余位。
void inverts_a_multi_bit_value_bit_by_bit() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);

    assert(circuit.addConnection({inputId, "out"}, {notId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::fromBits("10X")));
    assert(simulation.settle().succeeded());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::fromBits("01X"));

    // 再求值一次结果不变：已经确定的位不会被未知位带着一起塌掉。
    assert(simulation.settle().succeeded());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::fromBits("01X"));
}

// 定点迭代要一直走到每一位都到位。若收敛判据只比第一位，第二级 NOT 会停在初值 X。
void settles_a_multi_bit_not_chain() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto firstNotId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto secondNotId = circuit.addComponent(circuit::ComponentKind::NotGate);

    assert(circuit.addConnection({inputId, "out"}, {firstNotId, "in"}).succeeded());
    assert(circuit.addConnection({firstNotId, "out"}, {secondNotId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::fromBits("10X0")));
    assert(simulation.settle().succeeded());
    assert(simulation.signal({firstNotId, "out"}) == circuit::SignalValue::fromBits("01X1"));
    assert(simulation.signal({secondNotId, "out"}) == circuit::SignalValue::fromBits("10X0"));
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
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::zero());
    assert(simulation.step() == 0);
}

void flips_the_clock_once_per_tick() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);

    circuit::Simulation simulation(circuit);

    assert(simulation.tick().succeeded());
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::one());
    assert(simulation.step() == 1);

    assert(simulation.tick().succeeded());
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::zero());
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
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::one());
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
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::one());

    // 第一次推进把 Clock 从 0 翻到 1，组合逻辑随即传播到 Output。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::zero());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::zero());

    assert(simulation.tick().succeeded());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::one());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::one());
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
    assert(snapshotValue(simulation, {clockId, "out"}) == circuit::SignalValue::one());
    assert(snapshotValue(simulation, {notId, "out"}) == circuit::SignalValue::zero());
    assert(snapshotValue(simulation, {flipFlopId, "q"}) == circuit::SignalValue::unknown());
    assert(!snapshotValue(simulation, {outputId, "in"}).has_value());
}

// 一次往返要带回全部可展示读数，因此快照在输出端口之外还要覆盖 Output 元件的接收端。
void carries_output_receivers_in_the_signal_snapshot() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);
    assert(circuit.addConnection({clockId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    // 输出端口快照本身不含接收端；signalSnapshot 才把它带上。
    assert(!snapshotValue(simulation, {outputId, "in"}).has_value());

    const auto snapshotValueIn = [&](circuit::PortId portId) {
        for (const auto& signal : simulation.signalSnapshot()) {
            if (signal.port.component == portId.component && signal.port.name == portId.name) {
                return signal.value;
            }
        }
        return circuit::SignalValue::unknown();
    };

    assert(simulation.signalSnapshot().size() == 2);
    assert(snapshotValueIn({outputId, "in"}) == circuit::SignalValue::zero());

    assert(simulation.tick().succeeded());
    assert(snapshotValueIn({clockId, "out"}) == circuit::SignalValue::one());
    assert(snapshotValueIn({outputId, "in"}) == circuit::SignalValue::one());
}

void samples_d_on_the_clock_rising_edge() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({inputId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::one()));

    // 第一次有效上升沿之前 q 是 X：表示还没有采过样，而不是保存了 0。
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::unknown());

    // 第 1 次推进：Clock 从 0 翻到 1，是上升沿，把 d = 1 采样进 q。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    // 第 2 次推进：Clock 从 1 翻到 0，是下降沿，d 变了也不采样。
    assert(simulation.setInput(inputId, circuit::SignalValue::zero()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    // 第 3 次推进：又一个上升沿，这次把 d = 0 采样进 q。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::zero());
}

void samples_when_an_input_drives_the_clock_port() {
    circuit::Circuit circuit;
    const auto clockInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto dataInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockInputId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({dataInputId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataInputId, circuit::SignalValue::one()));

    // Input 的初值是 X，把它置 0 只是 X → 0，不构成上升沿。
    assert(simulation.setInput(clockInputId, circuit::SignalValue::zero()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::unknown());

    // 0 → 1 是上升沿：时钟来源是 Input 而不是 Clock 元件，判定完全一样。
    assert(simulation.setInput(clockInputId, circuit::SignalValue::one()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    // 下降沿上改变 d，q 按住不动。
    assert(simulation.setInput(dataInputId, circuit::SignalValue::zero()));
    assert(simulation.setInput(clockInputId, circuit::SignalValue::zero()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    // 下一次上升沿采样新的 d。
    assert(simulation.setInput(clockInputId, circuit::SignalValue::one()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::zero());
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
    assert(simulation.setInput(dataId, circuit::SignalValue::one()));
    assert(simulation.setInput(enableId, circuit::SignalValue::one()));
    assert(simulation.settle().succeeded());

    // 门控打开：Clock 翻到 1 时 AND 的输出从 0 变到 1，clock 端口上就是一个上升沿。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    // 门控关闭：AND 的输出恒为 0，Clock 继续翻转也构不成上升沿。
    assert(simulation.setInput(dataId, circuit::SignalValue::zero()));
    assert(simulation.setInput(enableId, circuit::SignalValue::zero()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());
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
    assert(simulation.setInput(dataId, circuit::SignalValue::one()));

    // 第一次推进：clock 端口的前值是 X，求值稳定后变成 1。X → 1 不是可靠的上升沿，
    // 因为上一拍可能本来就是 1，所以不采样。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({orId, "out"}) == circuit::SignalValue::one());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::unknown());

    // 之后每一拍都在 X 与 1 之间来回，永远凑不出 0 → 1。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::unknown());
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::unknown());
}

void leaves_a_flip_flop_without_a_clock_untouched() {
    circuit::Circuit circuit;
    const auto dataId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({dataId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataId, circuit::SignalValue::one()));

    // 没有连接 clock，端口一直读到 X，构不成上升沿：这是结构问题而不是错误，引擎不报错。
    for (int tick = 0; tick < 3; ++tick) {
        assert(simulation.tick().succeeded());
        assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::unknown());
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
    assert(simulation.setInput(dataId, circuit::SignalValue::one()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    // settle 只做组合求值到稳定：不推进 tick，也不改变 q。
    assert(simulation.setInput(dataId, circuit::SignalValue::zero()));
    assert(simulation.settle().succeeded());
    assert(simulation.settle().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());
    assert(simulation.step() == 1);
}

void resets_every_output_to_its_initial_value() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockId, "out"}, {notId, "in"}).succeeded());
    assert(circuit.addConnection({clockId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({inputId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::one()));
    assert(simulation.tick().succeeded());
    // 推进过后每个输出端口都不在初值上，重置才看得出区别。
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::one());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::zero());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());
    assert(simulation.step() == 1);

    simulation.reset();

    // 全部输出回到初始值：Clock 回到 0，其余端口回到 X；Input 的值同样回到初值。
    assert(simulation.step() == 0);
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::zero());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::unknown());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::unknown());
    assert(simulation.signal({inputId, "out"}) == circuit::SignalValue::unknown());
    // 信号表是被重建而不是被增量清理：端口数量与刚构造时一致，没有残留条目。
    assert(simulation.outputSignals().size() == 4);
}

void restarts_edge_detection_from_the_initial_state_after_reset() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto dataId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({dataId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataId, circuit::SignalValue::one()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    simulation.reset();
    assert(simulation.setInput(dataId, circuit::SignalValue::one()));

    // 重置后的第一次推进必须还是「Clock 从 0 翻到 1」这个上升沿。
    // 若前值快照被留在重置前（上一 tick 结束时是 1），这一次比较就是 1 对 1，
    // 既有的上升沿会被吞掉，q 会停在 X。
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());
    assert(simulation.step() == 1);
}

// 重置的语义等价于「用同一份 Circuit 重新构造一个 Simulation」：把同一串请求分别作用在
// 重置过的仿真与新建的仿真上，每一拍的输出快照与步数都必须一致。
void reset_matches_a_freshly_constructed_simulation() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto dataId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);

    assert(circuit.addConnection({clockId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({dataId, "out"}, {flipFlopId, "d"}).succeeded());
    assert(circuit.addConnection({flipFlopId, "q"}, {outputId, "in"}).succeeded());

    circuit::Simulation used(circuit);
    assert(used.setInput(dataId, circuit::SignalValue::one()));
    assert(used.tick().succeeded());
    assert(used.tick().succeeded());
    used.reset();
    assert(used.step() == 0);

    circuit::Simulation fresh(circuit);
    for (const auto value : {circuit::SignalValue::one(), circuit::SignalValue::zero()}) {
        assert(used.setInput(dataId, value));
        assert(fresh.setInput(dataId, value));
        assert(used.tick().succeeded());
        assert(fresh.tick().succeeded());
        assert(used.step() == fresh.step());

        const auto usedSnapshot = used.signalSnapshot();
        const auto freshSnapshot = fresh.signalSnapshot();
        assert(usedSnapshot.size() == freshSnapshot.size());
        for (std::size_t index = 0; index < usedSnapshot.size(); ++index) {
            assert(usedSnapshot[index].port.component == freshSnapshot[index].port.component);
            assert(usedSnapshot[index].port.name == freshSnapshot[index].port.name);
            assert(usedSnapshot[index].value == freshSnapshot[index].value);
        }
    }
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

// 结构变更不再是「重建仿真」：删掉一个与读数路径无关的元件，已提交的输入值必须还在。
// 旧实现（结构一变就重建整个 Simulation）会在这里把输入连同 AND 的结果一起清成 X。
void keeps_committed_input_values_across_a_structure_change() {
    circuit::Circuit circuit;
    const auto firstInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto secondInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto andId = circuit.addComponent(circuit::ComponentKind::AndGate);
    const auto outputId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto unrelatedId = circuit.addComponent(circuit::ComponentKind::NotGate);

    assert(circuit.addConnection({firstInputId, "out"}, {andId, "in1"}).succeeded());
    assert(circuit.addConnection({secondInputId, "out"}, {andId, "in2"}).succeeded());
    assert(circuit.addConnection({andId, "out"}, {outputId, "in"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(firstInputId, circuit::SignalValue::one()));
    assert(simulation.setInput(secondInputId, circuit::SignalValue::one()));
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::one());
    // 两个 Input 的 out、AND 的 out、以及那个无关 NOT 的 out。
    assert(simulation.outputSignals().size() == 4);

    assert(circuit.removeComponent(unrelatedId));
    simulation.reconcile();

    // 消失的端口连同它的值一起丢弃：状态表不再保留那个 NOT 的输出。
    assert(simulation.outputSignals().size() == 3);
    // 仍然存在的端口保留当前值，下游读数因此不变。
    assert(simulation.signal({firstInputId, "out"}) == circuit::SignalValue::one());
    assert(simulation.signal({secondInputId, "out"}) == circuit::SignalValue::one());
    assert(simulation.settle().succeeded());
    assert(simulation.signal({outputId, "in"}) == circuit::SignalValue::one());
}

// 结构变更新增的端口按初始值建立：Clock 的 out 是 0，其余输出是 X。
void initializes_ports_that_appear_after_a_structure_change() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(circuit::ComponentKind::Input);

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(inputId, circuit::SignalValue::one()));

    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto notId = circuit.addComponent(circuit::ComponentKind::NotGate);
    simulation.reconcile();

    assert(simulation.signal({inputId, "out"}) == circuit::SignalValue::one());
    assert(simulation.signal({clockId, "out"}) == circuit::SignalValue::zero());
    assert(simulation.signal({notId, "out"}) == circuit::SignalValue::unknown());
    assert(simulation.outputSignals().size() == 3);
}

// 删除时序元件本身：它保存的状态与它的时钟前值一起被丢弃，其余元件的状态不受影响。
// 时钟前值表的规模是这条断言的唯一观察点：残留条目在行为上不可达（元件身份永不重用），
// 协议层也读不到，所以这里必须借助 `trackedClockCountForTesting()` 这个测试观察点。
void drops_tracked_clock_values_of_removed_flip_flops() {
    circuit::Circuit circuit;
    const auto clockId = circuit.addComponent(circuit::ComponentKind::Clock);
    const auto firstFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);
    const auto secondFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockId, "out"}, {firstFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({clockId, "out"}, {secondFlopId, "clock"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.tick().succeeded());
    assert(simulation.trackedClockCountForTesting() == 2);

    assert(circuit.removeComponent(firstFlopId));
    simulation.reconcile();

    // 已删除的 DFlipFlop 不在状态表里留任何残留，也不再占着时钟前值表。
    assert(simulation.trackedClockCountForTesting() == 1);
    assert(simulation.outputSignals().size() == 2);
    assert(!simulation.signal({firstFlopId, "q"}).has_value());
    // 另一个 DFlipFlop 仍然被跟踪，后续推进照常。
    assert(simulation.tick().succeeded());
    assert(simulation.trackedClockCountForTesting() == 1);
    assert(simulation.signal({secondFlopId, "q"}).has_value());
}

// 保留下来的不只是端口值，还有触发器保存的位与它 clock 端口上的前值。
void keeps_the_sampled_bit_and_its_previous_clock_across_a_structure_change() {
    circuit::Circuit circuit;
    const auto clockInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto dataInputId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlopId = circuit.addComponent(circuit::ComponentKind::DFlipFlop);

    assert(circuit.addConnection({clockInputId, "out"}, {flipFlopId, "clock"}).succeeded());
    assert(circuit.addConnection({dataInputId, "out"}, {flipFlopId, "d"}).succeeded());

    circuit::Simulation simulation(circuit);
    assert(simulation.setInput(dataInputId, circuit::SignalValue::one()));
    assert(simulation.setInput(clockInputId, circuit::SignalValue::zero()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::unknown());

    // 0 → 1 的电平变化发生在两次 tick 之间：只有跨 tick 保留的前值才认得这次上升沿。
    assert(simulation.setInput(clockInputId, circuit::SignalValue::one()));
    const auto unrelatedId = circuit.addComponent(circuit::ComponentKind::NotGate);
    simulation.reconcile();

    assert(simulation.tick().succeeded());
    // 前值若被结构变更丢掉，本次会以「当前值 1」当作前值，判不出上升沿，q 会停在 X。
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    // 再删掉一个无关元件，采样得到的位仍然是 1。
    assert(circuit.removeComponent(unrelatedId));
    simulation.reconcile();
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());

    // 下一次推进是下降沿：q 按住不动，保留的前值继续参与上升沿判定。
    assert(simulation.setInput(clockInputId, circuit::SignalValue::zero()));
    assert(simulation.tick().succeeded());
    assert(simulation.signal({flipFlopId, "q"}) == circuit::SignalValue::one());
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
    carries_output_receivers_in_the_signal_snapshot();
    resets_every_output_to_its_initial_value();
    restarts_edge_detection_from_the_initial_state_after_reset();
    reset_matches_a_freshly_constructed_simulation();
    rejects_a_tick_that_cannot_settle();
    keeps_committed_input_values_across_a_structure_change();
    initializes_ports_that_appear_after_a_structure_change();
    drops_tracked_clock_values_of_removed_flip_flops();
    keeps_the_sampled_bit_and_its_previous_clock_across_a_structure_change();
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
    compares_signal_values_bit_by_bit();
    applies_the_gate_primitives_bit_by_bit();
    inverts_a_multi_bit_value_bit_by_bit();
    settles_a_multi_bit_not_chain();
    rejects_a_combinational_feedback_loop();
    return 0;
}
