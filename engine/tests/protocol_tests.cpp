#include "circuit/protocol.hpp"
#include "circuit/engine.hpp"
#include "circuit/request_handler.hpp"
#include "circuit/simulation.hpp"

#include <cassert>
#include <optional>
#include <string>

namespace {

std::string dispatch(
    std::string json, circuit::Circuit& circuit,
    std::optional<circuit::Simulation>& simulation) {
    const auto request = circuit::protocol::parseRequest(json);
    assert(request.has_value());
    const circuit::Engine engine;
    return circuit::handleRequest(*request, engine, circuit, simulation);
}

}  // namespace

int main() {
    const auto request = circuit::protocol::parseRequest(
        R"({"type":"add_connection","requestId":"req-7","sourceComponentId":12,"sourcePort":"out","targetComponentId":21,"targetPort":"in1"})");

    assert(request.has_value());
    assert(request->type == "add_connection");
    assert(request->requestId == "req-7");
    assert(request->sourceComponentId == 12);
    assert(request->sourcePort == "out");
    assert(request->targetComponentId == 21);
    assert(request->targetPort == "in1");

    const auto signalRequest = circuit::protocol::parseRequest(
        R"({"type":"set_input","requestId":"req-8","componentId":3,"value":"X"})");
    assert(signalRequest.has_value());
    assert(signalRequest->value == "X");

    const auto removeConnectionRequest = circuit::protocol::parseRequest(
        R"({"type":"remove_connection","requestId":"req-10","connectionId":7})");
    assert(removeConnectionRequest.has_value());
    assert(removeConnectionRequest->connectionId == 7);

    for (const auto malformedId : {
             R"({"type":"remove_component","requestId":"decimal","componentId":1.5})",
             R"({"type":"remove_component","requestId":"exponent","componentId":1e3})",
             R"({"type":"remove_component","requestId":"negative","componentId":-1})",
             R"({"type":"remove_component","requestId":"string","componentId":"1"})",
             R"({"type":"remove_component","requestId":"overflow","componentId":18446744073709551616})"}) {
        const auto malformedRequest = circuit::protocol::parseRequest(malformedId);
        assert(malformedRequest.has_value());
        assert(!malformedRequest->componentId.has_value());
    }

    const auto error = circuit::protocol::errorResponse("req-9", "bad_request", "测试错误");
    assert(error.find("\"requestId\":\"req-9\"") != std::string::npos);
    assert(error.find("测试错误") != std::string::npos);

    circuit::Circuit circuit;
    std::optional<circuit::Simulation> simulation;
    assert(dispatch(
               R"({"type":"add_component","requestId":"add-input-a","kind":"input"})",
               circuit, simulation)
               .find("\"componentId\":1") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_component","requestId":"add-input-b","kind":"input"})",
               circuit, simulation)
               .find("\"componentId\":2") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_component","requestId":"add-gate","kind":"and"})",
               circuit, simulation)
               .find("\"componentId\":3") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_component","requestId":"add-output","kind":"output"})",
               circuit, simulation)
               .find("\"componentId\":4") != std::string::npos);

    assert(dispatch(
               R"({"type":"add_connection","requestId":"connect-a","sourceComponentId":1,"sourcePort":"out","targetComponentId":3,"targetPort":"in1"})",
               circuit, simulation)
               .find("\"connectionId\":1") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_connection","requestId":"connect-b","sourceComponentId":2,"sourcePort":"out","targetComponentId":3,"targetPort":"in2"})",
               circuit, simulation)
               .find("\"connectionId\":2") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_connection","requestId":"connect-output","sourceComponentId":3,"sourcePort":"out","targetComponentId":4,"targetPort":"in"})",
               circuit, simulation)
               .find("\"connectionId\":3") != std::string::npos);

    assert(dispatch(
               R"({"type":"set_input","requestId":"set-a","componentId":1,"value":1})",
               circuit, simulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"set-b","componentId":2,"value":1})",
               circuit, simulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"settle","requestId":"settle-before-delete"})", circuit, simulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-before-delete","componentId":4,"port":"in"})",
               circuit, simulation)
               .find("\"value\":1") != std::string::npos);

    const auto missingComponentId = dispatch(
        R"({"type":"remove_component","requestId":"remove-missing"})", circuit, simulation);
    assert(missingComponentId.find("\"code\":\"bad_request\"") != std::string::npos);
    const auto zeroComponentId = dispatch(
        R"({"type":"remove_component","requestId":"remove-zero","componentId":0})",
        circuit, simulation);
    assert(zeroComponentId.find("\"code\":\"bad_request\"") != std::string::npos);
    const auto unknownComponent = dispatch(
        R"({"type":"remove_component","requestId":"remove-unknown","componentId":99})",
        circuit, simulation);
    assert(unknownComponent.find("\"code\":\"component_not_found\"") != std::string::npos);

    const auto removeComponent = dispatch(
        R"({"type":"remove_component","requestId":"remove-input-a","componentId":1})",
        circuit, simulation);
    assert(removeComponent ==
           R"({"type":"component_removed","requestId":"remove-input-a","componentId":1})");
    assert(circuit.connectionCount() == 3);
    assert(circuit.isDangling(1));
    assert(dispatch(
               R"({"type":"settle","requestId":"settle-after-component-delete"})", circuit, simulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-after-component-delete","componentId":4,"port":"in"})",
               circuit, simulation)
               .find("\"value\":\"X\"") != std::string::npos);

    const auto missingConnectionId = dispatch(
        R"({"type":"remove_connection","requestId":"remove-connection-missing"})",
        circuit, simulation);
    assert(missingConnectionId.find("\"code\":\"bad_request\"") != std::string::npos);
    const auto unknownConnection = dispatch(
        R"({"type":"remove_connection","requestId":"remove-connection-unknown","connectionId":99})",
        circuit, simulation);
    assert(unknownConnection.find("\"code\":\"connection_not_found\"") != std::string::npos);

    const auto removeConnection = dispatch(
        R"({"type":"remove_connection","requestId":"remove-output-connection","connectionId":3})",
        circuit, simulation);
    assert(removeConnection ==
           R"({"type":"connection_removed","requestId":"remove-output-connection","connectionId":3})");
    assert(circuit.connectionCount() == 2);
    assert(circuit.component(3).has_value());
    assert(circuit.component(4).has_value());
    assert(dispatch(
               R"({"type":"settle","requestId":"settle-after-connection-delete"})", circuit, simulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-after-connection-delete","componentId":4,"port":"in"})",
               circuit, simulation)
               .find("\"value\":\"X\"") != std::string::npos);

    circuit::Circuit connectedCircuit;
    const auto connectedInput = connectedCircuit.addComponent(circuit::ComponentKind::Input);
    const auto connectedOutput = connectedCircuit.addComponent(circuit::ComponentKind::Output);
    const auto connected = connectedCircuit.addConnection(
        {connectedInput, "out"}, {connectedOutput, "in"});
    assert(connected.succeeded());
    std::optional<circuit::Simulation> connectedSimulation{connectedCircuit};
    assert(connectedSimulation->setInput(connectedInput, circuit::SignalValue::One));
    assert(connectedSimulation->settle().succeeded());
    assert(connectedSimulation->signal({connectedOutput, "in"}) == circuit::SignalValue::One);

    const auto removedLiveConnection = dispatch(
        R"({"type":"remove_connection","requestId":"remove-live-connection","connectionId":1})",
        connectedCircuit, connectedSimulation);
    assert(removedLiveConnection ==
           R"({"type":"connection_removed","requestId":"remove-live-connection","connectionId":1})");
    assert(connectedCircuit.component(connectedInput).has_value());
    assert(connectedCircuit.component(connectedOutput).has_value());
    assert(connectedSimulation->signal({connectedOutput, "in"}) == circuit::SignalValue::Unknown);

    // 一次推进把全部输出端口的当前值与步数一起带回，取代按端口逐条 get_signal。
    circuit::Circuit clockCircuit;
    const auto clockComponent = clockCircuit.addComponent(circuit::ComponentKind::Clock);
    const auto inverter = clockCircuit.addComponent(circuit::ComponentKind::NotGate);
    const auto clockOutput = clockCircuit.addComponent(circuit::ComponentKind::Output);
    assert(clockCircuit.addConnection({clockComponent, "out"}, {inverter, "in"}).succeeded());
    assert(clockCircuit.addConnection({inverter, "out"}, {clockOutput, "in"}).succeeded());
    std::optional<circuit::Simulation> clockSimulation;

    const auto firstTick = dispatch(
        R"({"type":"tick","requestId":"tick-1"})", clockCircuit, clockSimulation);
    assert(firstTick.find("\"type\":\"ticked\"") != std::string::npos);
    assert(firstTick.find("\"requestId\":\"tick-1\"") != std::string::npos);
    assert(firstTick.find("\"step\":1") != std::string::npos);
    assert(firstTick.find(
               "{\"componentId\":1,\"port\":\"out\",\"value\":1}") != std::string::npos);
    assert(firstTick.find(
               "{\"componentId\":2,\"port\":\"out\",\"value\":0}") != std::string::npos);

    // 快照同时覆盖 Output 元件的接收端，调用方因此不必再逐端口 get_signal 就能拿到它的读数。
    assert(firstTick.find(
               "{\"componentId\":3,\"port\":\"in\",\"value\":0}") != std::string::npos);

    const auto secondTick = dispatch(
        R"({"type":"tick","requestId":"tick-2"})", clockCircuit, clockSimulation);
    assert(secondTick.find("\"step\":2") != std::string::npos);
    assert(secondTick.find(
               "{\"componentId\":1,\"port\":\"out\",\"value\":0}") != std::string::npos);
    assert(secondTick.find(
               "{\"componentId\":2,\"port\":\"out\",\"value\":1}") != std::string::npos);
    assert(secondTick.find(
               "{\"componentId\":3,\"port\":\"in\",\"value\":1}") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-after-tick","componentId":3,"port":"in"})",
               clockCircuit, clockSimulation)
               .find("\"value\":1") != std::string::npos);

    // 一整条时序链路走 JSON：Clock 驱动 clock 端口，Input 驱动 d，q 接到 Output。
    circuit::Circuit flipFlopCircuit;
    const auto flipFlopClock = flipFlopCircuit.addComponent(circuit::ComponentKind::Clock);
    const auto flipFlopData = flipFlopCircuit.addComponent(circuit::ComponentKind::Input);
    const auto flipFlop = flipFlopCircuit.addComponent(circuit::ComponentKind::DFlipFlop);
    const auto flipFlopOutput = flipFlopCircuit.addComponent(circuit::ComponentKind::Output);
    assert(flipFlopCircuit.addConnection({flipFlopClock, "out"}, {flipFlop, "clock"}).succeeded());
    assert(flipFlopCircuit.addConnection({flipFlopData, "out"}, {flipFlop, "d"}).succeeded());
    assert(flipFlopCircuit.addConnection({flipFlop, "q"}, {flipFlopOutput, "in"}).succeeded());
    std::optional<circuit::Simulation> flipFlopSimulation;

    assert(dispatch(
               R"({"type":"set_input","requestId":"d-one","componentId":2,"value":"1"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);

    // 第一次推进是 clock 端口的 0 → 1：q 从 X 变成采到的 1，并沿 Connection 传到 Output。
    const auto risingEdge = dispatch(
        R"({"type":"tick","requestId":"tick-rising"})", flipFlopCircuit, flipFlopSimulation);
    assert(risingEdge.find("\"step\":1") != std::string::npos);
    assert(risingEdge.find(
               "{\"componentId\":3,\"port\":\"q\",\"value\":1}") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-q","componentId":4,"port":"in"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"value\":1") != std::string::npos);

    // 第二次推进是下降沿：d 已经变成 0，q 仍然按住 1。
    assert(dispatch(
               R"({"type":"set_input","requestId":"d-zero","componentId":2,"value":"0"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    const auto fallingEdge = dispatch(
        R"({"type":"tick","requestId":"tick-falling"})", flipFlopCircuit, flipFlopSimulation);
    assert(fallingEdge.find("\"step\":2") != std::string::npos);
    assert(fallingEdge.find(
               "{\"componentId\":3,\"port\":\"q\",\"value\":1}") != std::string::npos);

    // 第三次推进又是上升沿：这次把 d = 0 采样进 q。
    const auto secondRisingEdge = dispatch(
        R"({"type":"tick","requestId":"tick-rising-again"})", flipFlopCircuit, flipFlopSimulation);
    assert(secondRisingEdge.find("\"step\":3") != std::string::npos);
    assert(secondRisingEdge.find(
               "{\"componentId\":3,\"port\":\"q\",\"value\":0}") != std::string::npos);

    // 重置把这份仿真恢复到刚建立时的状态；它是一条独立请求，没有业务失败分支。
    const auto resetResponse = dispatch(
        R"({"type":"reset","requestId":"reset-1"})", flipFlopCircuit, flipFlopSimulation);
    assert(resetResponse == R"({"type":"reset_done","requestId":"reset-1","status":"ok"})");
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-q-after-reset","componentId":3,"port":"q"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"value\":\"X\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-clock-after-reset","componentId":1,"port":"out"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"value\":0") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-d-after-reset","componentId":2,"port":"out"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"value\":\"X\"") != std::string::npos);

    // Input 的值也回到初值，因此重置后要重新提交才能重现刚建立时的第一个上升沿。
    assert(dispatch(
               R"({"type":"set_input","requestId":"d-after-reset","componentId":2,"value":"1"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    const auto tickAfterReset = dispatch(
        R"({"type":"tick","requestId":"tick-after-reset"})", flipFlopCircuit, flipFlopSimulation);
    // 步数从 0 重新计数，q 与刚建立时一样在第一个 0 → 1 上升沿采到 d = 1。
    assert(tickAfterReset.find("\"step\":1") != std::string::npos);
    assert(tickAfterReset.find("{\"componentId\":3,\"port\":\"q\",\"value\":1}") != std::string::npos);

    // 重置不触碰 Circuit：元件、连接与它们的引擎身份原样保留，新元件仍拿到递增的身份。
    assert(flipFlopCircuit.component(flipFlopClock).has_value());
    assert(flipFlopCircuit.component(flipFlopOutput).has_value());
    assert(flipFlopCircuit.connectionCount() == 3);
    assert(flipFlopCircuit.addComponent(circuit::ComponentKind::NotGate) == 5);

    // 没有仿真时重置先按当前 Circuit 建立再清空，因此空电路上也不会失败。
    circuit::Circuit resetOnlyCircuit;
    std::optional<circuit::Simulation> resetOnlySimulation;
    assert(dispatch(R"({"type":"reset","requestId":"reset-lazy"})", resetOnlyCircuit, resetOnlySimulation) ==
           R"({"type":"reset_done","requestId":"reset-lazy","status":"ok"})");
    assert(resetOnlySimulation.has_value());
    assert(resetOnlySimulation->step() == 0);

    circuit::Circuit loopCircuit;
    const auto loopFirst = loopCircuit.addComponent(circuit::ComponentKind::NotGate);
    const auto loopSecond = loopCircuit.addComponent(circuit::ComponentKind::NotGate);
    assert(loopCircuit.addConnection({loopFirst, "out"}, {loopSecond, "in"}).succeeded());
    assert(loopCircuit.addConnection({loopSecond, "out"}, {loopFirst, "in"}).succeeded());
    std::optional<circuit::Simulation> loopSimulation;
    assert(dispatch(R"({"type":"tick","requestId":"tick-loop"})", loopCircuit, loopSimulation)
               .find("\"code\":\"combinational_loop\"") != std::string::npos);

    // 结构变更按元件身份保留运行时状态。下面两组断言专门区分「保留」与「重建」：
    // 读数不再来自「端口被删了」这个结构事实，而是来自仍然存在的元件上的当前值。
    circuit::Circuit keepCircuit;
    const auto keepFirstInput = keepCircuit.addComponent(circuit::ComponentKind::Input);
    const auto keepSecondInput = keepCircuit.addComponent(circuit::ComponentKind::Input);
    const auto keepAnd = keepCircuit.addComponent(circuit::ComponentKind::AndGate);
    const auto keepOutput = keepCircuit.addComponent(circuit::ComponentKind::Output);
    const auto keepUnrelatedOutput = keepCircuit.addComponent(circuit::ComponentKind::Output);
    assert(keepCircuit.addConnection({keepFirstInput, "out"}, {keepAnd, "in1"}).succeeded());
    assert(keepCircuit.addConnection({keepSecondInput, "out"}, {keepAnd, "in2"}).succeeded());
    assert(keepCircuit.addConnection({keepAnd, "out"}, {keepOutput, "in"}).succeeded());
    std::optional<circuit::Simulation> keepSimulation;

    assert(dispatch(
               R"({"type":"set_input","requestId":"keep-a","componentId":1,"value":1})",
               keepCircuit, keepSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"keep-b","componentId":2,"value":1})",
               keepCircuit, keepSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(R"({"type":"settle","requestId":"keep-settle"})", keepCircuit, keepSimulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-before","componentId":4,"port":"in"})",
               keepCircuit, keepSimulation)
               .find("\"value\":1") != std::string::npos);

    // 删掉一个与读数路径无关的 Output：它不参与求值，也不是任何状态的载体。
    assert(dispatch(
               R"({"type":"remove_component","requestId":"keep-remove","componentId":5})",
               keepCircuit, keepSimulation)
               .find("\"type\":\"component_removed\"") != std::string::npos);

    // 两个 Input 都没有被删，它们的已提交值必须原样保留：旧实现会在这里把状态整体重建，
    // 两个读数都会变成 X。这两条断言才是「不出现删掉一个无关元件导致全部时序状态丢失」的直接测试形态。
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-a","componentId":1,"port":"out"})",
               keepCircuit, keepSimulation)
               .find("\"value\":1") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-b","componentId":2,"port":"out"})",
               keepCircuit, keepSimulation)
               .find("\"value\":1") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-after","componentId":4,"port":"in"})",
               keepCircuit, keepSimulation)
               .find("\"value\":1") != std::string::npos);

    // 添加元件同样按身份保留：新增元件的输出按初始值建立，不碰既有 Input 的当前值。
    assert(dispatch(
               R"({"type":"add_component","requestId":"keep-add","kind":"not"})",
               keepCircuit, keepSimulation)
               .find("\"componentId\":6") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-a-after-add","componentId":1,"port":"out"})",
               keepCircuit, keepSimulation)
               .find("\"value\":1") != std::string::npos);

    // 时序元件保存的位与它 clock 端口上的前值同样按身份保留。
    circuit::Circuit holdCircuit;
    const auto holdClock = holdCircuit.addComponent(circuit::ComponentKind::Input);
    const auto holdData = holdCircuit.addComponent(circuit::ComponentKind::Input);
    const auto holdFlop = holdCircuit.addComponent(circuit::ComponentKind::DFlipFlop);
    const auto holdUnrelated = holdCircuit.addComponent(circuit::ComponentKind::Output);
    assert(holdCircuit.addConnection({holdClock, "out"}, {holdFlop, "clock"}).succeeded());
    assert(holdCircuit.addConnection({holdData, "out"}, {holdFlop, "d"}).succeeded());
    std::optional<circuit::Simulation> holdSimulation;

    assert(dispatch(
               R"({"type":"set_input","requestId":"hold-data","componentId":2,"value":1})",
               holdCircuit, holdSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"hold-clock-low","componentId":1,"value":0})",
               holdCircuit, holdSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(R"({"type":"tick","requestId":"hold-tick-idle"})", holdCircuit, holdSimulation)
               .find("\"type\":\"ticked\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-q-before","componentId":3,"port":"q"})",
               holdCircuit, holdSimulation)
               .find("\"value\":\"X\"") != std::string::npos);

    // 时钟电平在两次 tick 之间抬起来。这一次 0 → 1 只有靠跨 tick 保留的时钟前值才认得出来，
    // 因此下面的断言同时守住「q 被保留」与「clock 端口的前值被保留」。
    assert(dispatch(
               R"({"type":"set_input","requestId":"hold-clock-high","componentId":1,"value":1})",
               holdCircuit, holdSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"remove_component","requestId":"hold-remove","componentId":4})",
               holdCircuit, holdSimulation)
               .find("\"type\":\"component_removed\"") != std::string::npos);
    assert(dispatch(R"({"type":"tick","requestId":"hold-tick-rising"})", holdCircuit, holdSimulation)
               .find("\"type\":\"ticked\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-q-after","componentId":3,"port":"q"})",
               holdCircuit, holdSimulation)
               .find("\"value\":1") != std::string::npos);

    // 再添加一个元件：已积累的时序状态同样不受影响。
    assert(dispatch(
               R"({"type":"add_component","requestId":"hold-add","kind":"and"})",
               holdCircuit, holdSimulation)
               .find("\"componentId\":5") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-q-after-add","componentId":3,"port":"q"})",
               holdCircuit, holdSimulation)
               .find("\"value\":1") != std::string::npos);

    // 下一次推进是下降沿：q 按住不动，保留下来的前值继续参与边沿判定。
    assert(dispatch(
               R"({"type":"set_input","requestId":"hold-clock-low-again","componentId":1,"value":0})",
               holdCircuit, holdSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(R"({"type":"tick","requestId":"hold-tick-falling"})", holdCircuit, holdSimulation)
               .find("\"type\":\"ticked\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-q-falling","componentId":3,"port":"q"})",
               holdCircuit, holdSimulation)
               .find("\"value\":1") != std::string::npos);

    // 删除时序元件本身：它保存的状态被丢弃，其余元件的状态不受影响。
    assert(dispatch(
               R"({"type":"remove_component","requestId":"hold-remove-flop","componentId":3})",
               holdCircuit, holdSimulation)
               .find("\"type\":\"component_removed\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-q-dropped","componentId":3,"port":"q"})",
               holdCircuit, holdSimulation)
               .find("\"code\":\"port_not_found\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-clock-value","componentId":1,"port":"out"})",
               holdCircuit, holdSimulation)
               .find("\"value\":0") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-data-value","componentId":2,"port":"out"})",
               holdCircuit, holdSimulation)
               .find("\"value\":1") != std::string::npos);

    return 0;
}
