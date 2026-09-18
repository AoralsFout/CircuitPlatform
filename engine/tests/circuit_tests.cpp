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

// 内置定义的端口位宽都是 1：位宽成为 Port 的属性之后，既有元件的形状不变。
void built_in_port_lists_declare_width_one() {
    circuit::Circuit circuit;
    const auto gateId = circuit.addComponent(circuit::ComponentKind::AndGate);
    const auto gate = circuit.component(gateId);

    assert(gate.has_value());
    for (const auto& port : gate->ports) {
        assert(port.width == 1);
        assert(!port.bitRange.has_value());
    }
}

// 携带端口清单时按清单建立；端口清单是位宽的唯一权威来源。
void uses_a_supplied_port_list_instead_of_the_built_in_one() {
    circuit::Circuit circuit;
    const auto inputId = circuit.addComponent(
        circuit::ComponentKind::Input,
        {{"out", circuit::PortDirection::Output, 8, std::nullopt}});

    const auto input = circuit.component(inputId);
    assert(input.has_value());
    assert(input->ports.size() == 1);
    assert(input->ports[0].name == "out");
    assert(input->ports[0].width == 8);
}

// 位区间跟着端口清单一起走，是 Port 自己的属性。
void carries_a_bit_range_on_the_port_that_declares_it() {
    circuit::Circuit circuit;
    const auto splitterId = circuit.addComponent(
        circuit::ComponentKind::Input,
        {{"out", circuit::PortDirection::Output, 4, circuit::PortBitRange{7, 4}}});

    const auto splitter = circuit.component(splitterId);
    assert(splitter.has_value());
    assert(splitter->ports[0].bitRange.has_value());
    assert(splitter->ports[0].bitRange->msb == 7);
    assert(splitter->ports[0].bitRange->lsb == 4);
}

// 两端位宽不同直接拒绝，不做零扩展、符号扩展或截断：连接根本没被创建。
void rejects_a_connection_between_different_widths() {
    circuit::Circuit circuit;
    const auto wideInput = circuit.addComponent(
        circuit::ComponentKind::Input,
        {{"out", circuit::PortDirection::Output, 8, std::nullopt}});
    const auto narrowOutput = circuit.addComponent(circuit::ComponentKind::Output);

    const auto result = circuit.addConnection({wideInput, "out"}, {narrowOutput, "in"});

    assert(!result.succeeded());
    assert(result.error == circuit::ConnectionError::WidthMismatch);
    assert(!result.id.has_value());
    assert(circuit.connectionCount() == 0);
}

// 悬空的第二个条件：两端位宽不再相同。连接保留在 Circuit 里，只是不参与仿真。
void a_width_mismatch_makes_a_connection_dangling() {
    circuit::Circuit circuit;
    const auto sourceId = circuit.addComponent(
        circuit::ComponentKind::Input,
        {{"out", circuit::PortDirection::Output, 8, std::nullopt}});
    const auto targetId = circuit.addComponent(
        circuit::ComponentKind::Output,
        {{"in", circuit::PortDirection::Input, 8, std::nullopt}});
    const auto connection = circuit.addConnection({sourceId, "out"}, {targetId, "in"});

    assert(connection.succeeded());
    assert(!circuit.isDangling(*connection.id));

    assert(circuit.setComponentPorts(
        targetId, {{"in", circuit::PortDirection::Input, 4, std::nullopt}}));
    assert(circuit.isDangling(*connection.id));
    assert(circuit.connectionCount() == 1);

    // 改宽是一次整体替换：改回原样，两端重新匹配，连接自动恢复有效——没有需要清理的存档标志。
    assert(circuit.setComponentPorts(
        targetId, {{"in", circuit::PortDirection::Input, 8, std::nullopt}}));
    assert(!circuit.isDangling(*connection.id));
}

// 改宽后不再匹配的输入端口不再占用该输入端，因此可以重接一条新的有效连接。
void a_width_mismatched_connection_does_not_block_reconnecting_the_input() {
    circuit::Circuit circuit;
    const auto wideSourceId = circuit.addComponent(
        circuit::ComponentKind::Input,
        {{"out", circuit::PortDirection::Output, 8, std::nullopt}});
    const auto targetId = circuit.addComponent(
        circuit::ComponentKind::Output,
        {{"in", circuit::PortDirection::Input, 8, std::nullopt}});
    const auto stale = circuit.addConnection({wideSourceId, "out"}, {targetId, "in"});
    assert(stale.succeeded());

    assert(circuit.setComponentPorts(
        targetId, {{"in", circuit::PortDirection::Input, 4, std::nullopt}}));
    assert(circuit.isDangling(*stale.id));

    const auto narrowSourceId = circuit.addComponent(
        circuit::ComponentKind::Input,
        {{"out", circuit::PortDirection::Output, 4, std::nullopt}});
    const auto replacement = circuit.addConnection({narrowSourceId, "out"}, {targetId, "in"});

    assert(replacement.succeeded());
    assert(!circuit.isDangling(*replacement.id));
    assert(circuit.connectionCount() == 2);
}

// 悬空连接的枚举与逐个询问必须给出同一套判定。
void lists_dangling_connections_in_creation_order() {
    circuit::Circuit circuit;
    const auto sourceId = circuit.addComponent(circuit::ComponentKind::Input);
    const auto firstTargetId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto secondTargetId = circuit.addComponent(circuit::ComponentKind::Output);
    const auto first = circuit.addConnection({sourceId, "out"}, {firstTargetId, "in"});
    const auto second = circuit.addConnection({sourceId, "out"}, {secondTargetId, "in"});

    assert(first.succeeded() && second.succeeded());
    assert(circuit.danglingConnections().empty());

    assert(circuit.removeComponent(firstTargetId));
    const auto dangling = circuit.danglingConnections();
    assert(dangling.size() == 1);
    assert(dangling[0] == *first.id);
}

// 端口声明本身的领域规则：位宽至少为 1，位区间必须落在自己的位宽内。
void validates_port_width_and_bit_range() {
    assert(circuit::validatePort({"out", circuit::PortDirection::Output, 1, std::nullopt}) ==
           circuit::PortError::None);
    assert(circuit::validatePort({"out", circuit::PortDirection::Output, 0, std::nullopt}) ==
           circuit::PortError::InvalidWidth);
    assert(circuit::validatePort(
               {"out", circuit::PortDirection::Output, 4, circuit::PortBitRange{7, 4}}) ==
           circuit::PortError::None);
    assert(circuit::validatePort(
               {"out", circuit::PortDirection::Output, 4, circuit::PortBitRange{4, 7}}) ==
           circuit::PortError::InvalidBitRange);
    // 位区间决定位宽，两者不一致就不是一份自洽的声明。
    assert(circuit::validatePort(
               {"out", circuit::PortDirection::Output, 3, circuit::PortBitRange{7, 4}}) ==
           circuit::PortError::InvalidBitRange);
}

// 位区间盖满宿主总线的每一位且互不重叠，这份清单就成立——分成几条、每条多宽都由数据决定。
void accepts_bit_ranges_that_cover_the_whole_host_bus() {
    const auto bitRange = [](std::string name, circuit::PortDirection direction, std::uint32_t width,
                             std::uint32_t msb, std::uint32_t lsb) {
        return circuit::Port{std::move(name), direction, width, circuit::PortBitRange{msb, lsb}};
    };

    // 8 位总线拆成两个 4 位半区。
    assert(circuit::validatePortList(
               circuit::ComponentKind::Splitter,
               {{"in", circuit::PortDirection::Input, 8, std::nullopt},
                bitRange("out0", circuit::PortDirection::Output, 4, 7, 4),
                bitRange("out1", circuit::PortDirection::Output, 4, 3, 0)}) ==
           circuit::PortListError::None);

    // 逐位拆分：八条 1 位分支，从最高位开始编号。
    std::vector<circuit::Port> perBit{{"in", circuit::PortDirection::Input, 8, std::nullopt}};
    for (std::uint32_t index = 0; index < 8; ++index) {
        const auto bit = 7 - index;
        perBit.push_back({"out" + std::to_string(index), circuit::PortDirection::Output, 1,
                          circuit::PortBitRange{bit, bit}});
    }
    assert(circuit::validatePortList(circuit::ComponentKind::Splitter, perBit) ==
           circuit::PortListError::None);

    // 合线器与它对称：分支是输入、宿主是输出。
    assert(circuit::validatePortList(
               circuit::ComponentKind::Merger,
               {bitRange("in0", circuit::PortDirection::Input, 6, 7, 2),
                bitRange("in1", circuit::PortDirection::Input, 2, 1, 0),
                {"out", circuit::PortDirection::Output, 8, std::nullopt}}) ==
           circuit::PortListError::None);
}

// 漏掉一位与压住一位都是不成立的清单，而且各自报成不同的原因。
void rejects_bit_ranges_that_do_not_tile_the_host_bus() {
    const auto branch = [](std::uint32_t msb, std::uint32_t lsb) {
        return circuit::Port{"out", circuit::PortDirection::Output, msb - lsb + 1,
                             circuit::PortBitRange{msb, lsb}};
    };
    const circuit::Port host{"in", circuit::PortDirection::Input, 8, std::nullopt};

    // 漏位：位 1 没有任何分支覆盖。
    assert(circuit::validatePortList(circuit::ComponentKind::Splitter,
                                     {host, branch(7, 2), branch(0, 0)}) ==
           circuit::PortListError::Incomplete);

    // 重叠：位 2 与位 3 被两条分支同时覆盖。
    assert(circuit::validatePortList(circuit::ComponentKind::Splitter,
                                     {host, branch(7, 2), branch(3, 0)}) ==
           circuit::PortListError::Overlap);

    // 越界：位 8 不在宿主总线上。
    assert(circuit::validatePortList(circuit::ComponentKind::Splitter,
                                     {host, branch(8, 0)}) ==
           circuit::PortListError::OutOfRange);

    // 分支数超过总位宽时，多出来的那条一定压住别人。
    assert(circuit::validatePortList(
               circuit::ComponentKind::Splitter,
               {std::move(host), branch(7, 4), branch(3, 0), branch(7, 7)}) ==
           circuit::PortListError::Overlap);
}

// 形状不对的清单先报形状：没有覆盖规则可以套在一份没有宿主总线的清单上。
void rejects_a_port_list_that_is_not_one_host_plus_branches() {
    const circuit::Port host{"in", circuit::PortDirection::Input, 8, std::nullopt};

    // 没有宿主总线端口。
    assert(circuit::validatePortList(
               circuit::ComponentKind::Splitter,
               {{"out0", circuit::PortDirection::Output, 8, circuit::PortBitRange{7, 0}}}) ==
           circuit::PortListError::Malformed);

    // 两条宿主总线端口。
    assert(circuit::validatePortList(
               circuit::ComponentKind::Splitter,
               {host, {"in2", circuit::PortDirection::Input, 8, std::nullopt},
                {"out0", circuit::PortDirection::Output, 8, circuit::PortBitRange{7, 0}}}) ==
           circuit::PortListError::Malformed);

    // 拆线器的分支必须是输出；给成输入就不是这个元件了。
    assert(circuit::validatePortList(
               circuit::ComponentKind::Splitter,
               {host, {"out0", circuit::PortDirection::Input, 8, circuit::PortBitRange{7, 0}}}) ==
           circuit::PortListError::Malformed);
}

// 覆盖规则只对数据驱动的两个元件成立；内置元件的形状不归这份清单管。
void applies_the_coverage_rule_only_to_the_data_driven_kinds() {
    assert(circuit::validatePortList(
               circuit::ComponentKind::AndGate,
               {{"in1", circuit::PortDirection::Input, 1, std::nullopt},
                {"in2", circuit::PortDirection::Input, 1, std::nullopt},
                {"out", circuit::PortDirection::Output, 1, std::nullopt}}) ==
           circuit::PortListError::None);

    // 端口清单是空的时候也一样：没有分支就没有覆盖问题。
    assert(circuit::validatePortList(circuit::ComponentKind::Input, {}) ==
           circuit::PortListError::None);
}

// 替换端口清单只动清单；元件身份不变，不存在的元件仍由返回值报告。
void replacing_ports_keeps_the_component_identity() {
    circuit::Circuit circuit;
    const auto componentId = circuit.addComponent(circuit::ComponentKind::Input);
    assert(!circuit.setComponentPorts(99, {{"out", circuit::PortDirection::Output, 2, std::nullopt}}));

    assert(circuit.setComponentPorts(
        componentId, {{"a", circuit::PortDirection::Output, 2, std::nullopt}}));
    const auto component = circuit.component(componentId);
    assert(component.has_value());
    assert(component->ports.size() == 1);
    assert(component->ports[0].name == "a");
    assert(component->ports[0].width == 2);
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
    built_in_port_lists_declare_width_one();
    uses_a_supplied_port_list_instead_of_the_built_in_one();
    carries_a_bit_range_on_the_port_that_declares_it();
    rejects_a_connection_between_different_widths();
    a_width_mismatch_makes_a_connection_dangling();
    a_width_mismatched_connection_does_not_block_reconnecting_the_input();
    lists_dangling_connections_in_creation_order();
    validates_port_width_and_bit_range();
    accepts_bit_ranges_that_cover_the_whole_host_bus();
    rejects_bit_ranges_that_do_not_tile_the_host_bus();
    rejects_a_port_list_that_is_not_one_host_plus_branches();
    applies_the_coverage_rule_only_to_the_data_driven_kinds();
    replacing_ports_keeps_the_component_identity();
    return 0;
}
