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

    // 信号值统一是字符串：数字形式不再被接受，`value` 因此读不到。
    const auto numericValue = circuit::protocol::parseRequest(
        R"({"type":"set_input","requestId":"req-11","componentId":3,"value":1})");
    assert(numericValue.has_value());
    assert(!numericValue->value.has_value());

    // 字段层只要求是字符串；长度是否等于端口位宽由请求处理器判定，因此多位值在这里读得出来。
    const auto multiBitValue = circuit::protocol::parseRequest(
        R"({"type":"set_input","requestId":"req-12","componentId":3,"value":"10X"})");
    assert(multiBitValue.has_value());
    assert(multiBitValue->value == "10X");

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
               R"({"type":"set_input","requestId":"set-a","componentId":1,"value":"1"})",
               circuit, simulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"set-b","componentId":2,"value":"1"})",
               circuit, simulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"settle","requestId":"settle-before-delete"})", circuit, simulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-before-delete","componentId":4,"port":"in"})",
               circuit, simulation)
               .find("\"value\":\"1\"") != std::string::npos);

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
    assert(connectedSimulation->setInput(connectedInput, circuit::SignalValue::one()));
    assert(connectedSimulation->settle().succeeded());
    assert(connectedSimulation->signal({connectedOutput, "in"}) == circuit::SignalValue::one());

    const auto removedLiveConnection = dispatch(
        R"({"type":"remove_connection","requestId":"remove-live-connection","connectionId":1})",
        connectedCircuit, connectedSimulation);
    assert(removedLiveConnection ==
           R"({"type":"connection_removed","requestId":"remove-live-connection","connectionId":1})");
    assert(connectedCircuit.component(connectedInput).has_value());
    assert(connectedCircuit.component(connectedOutput).has_value());
    assert(connectedSimulation->signal({connectedOutput, "in"}) == circuit::SignalValue::unknown());

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
               "{\"componentId\":1,\"port\":\"out\",\"value\":\"1\"}") != std::string::npos);
    assert(firstTick.find(
               "{\"componentId\":2,\"port\":\"out\",\"value\":\"0\"}") != std::string::npos);

    // 快照同时覆盖 Output 元件的接收端，调用方因此不必再逐端口 get_signal 就能拿到它的读数。
    assert(firstTick.find(
               "{\"componentId\":3,\"port\":\"in\",\"value\":\"0\"}") != std::string::npos);

    const auto secondTick = dispatch(
        R"({"type":"tick","requestId":"tick-2"})", clockCircuit, clockSimulation);
    assert(secondTick.find("\"step\":2") != std::string::npos);
    assert(secondTick.find(
               "{\"componentId\":1,\"port\":\"out\",\"value\":\"0\"}") != std::string::npos);
    assert(secondTick.find(
               "{\"componentId\":2,\"port\":\"out\",\"value\":\"1\"}") != std::string::npos);
    assert(secondTick.find(
               "{\"componentId\":3,\"port\":\"in\",\"value\":\"1\"}") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-after-tick","componentId":3,"port":"in"})",
               clockCircuit, clockSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

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
               "{\"componentId\":3,\"port\":\"q\",\"value\":\"1\"}") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-q","componentId":4,"port":"in"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

    // 第二次推进是下降沿：d 已经变成 0，q 仍然按住 1。
    assert(dispatch(
               R"({"type":"set_input","requestId":"d-zero","componentId":2,"value":"0"})",
               flipFlopCircuit, flipFlopSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    const auto fallingEdge = dispatch(
        R"({"type":"tick","requestId":"tick-falling"})", flipFlopCircuit, flipFlopSimulation);
    assert(fallingEdge.find("\"step\":2") != std::string::npos);
    assert(fallingEdge.find(
               "{\"componentId\":3,\"port\":\"q\",\"value\":\"1\"}") != std::string::npos);

    // 第三次推进又是上升沿：这次把 d = 0 采样进 q。
    const auto secondRisingEdge = dispatch(
        R"({"type":"tick","requestId":"tick-rising-again"})", flipFlopCircuit, flipFlopSimulation);
    assert(secondRisingEdge.find("\"step\":3") != std::string::npos);
    assert(secondRisingEdge.find(
               "{\"componentId\":3,\"port\":\"q\",\"value\":\"0\"}") != std::string::npos);

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
               .find("\"value\":\"0\"") != std::string::npos);
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
    assert(tickAfterReset.find("{\"componentId\":3,\"port\":\"q\",\"value\":\"1\"}") != std::string::npos);

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
               R"({"type":"set_input","requestId":"keep-a","componentId":1,"value":"1"})",
               keepCircuit, keepSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"keep-b","componentId":2,"value":"1"})",
               keepCircuit, keepSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(R"({"type":"settle","requestId":"keep-settle"})", keepCircuit, keepSimulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-before","componentId":4,"port":"in"})",
               keepCircuit, keepSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

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
               .find("\"value\":\"1\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-b","componentId":2,"port":"out"})",
               keepCircuit, keepSimulation)
               .find("\"value\":\"1\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-after","componentId":4,"port":"in"})",
               keepCircuit, keepSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

    // 添加元件同样按身份保留：新增元件的输出按初始值建立，不碰既有 Input 的当前值。
    assert(dispatch(
               R"({"type":"add_component","requestId":"keep-add","kind":"not"})",
               keepCircuit, keepSimulation)
               .find("\"componentId\":6") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"keep-read-a-after-add","componentId":1,"port":"out"})",
               keepCircuit, keepSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

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
               R"({"type":"set_input","requestId":"hold-data","componentId":2,"value":"1"})",
               holdCircuit, holdSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"hold-clock-low","componentId":1,"value":"0"})",
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
               R"({"type":"set_input","requestId":"hold-clock-high","componentId":1,"value":"1"})",
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
               .find("\"value\":\"1\"") != std::string::npos);

    // 再添加一个元件：已积累的时序状态同样不受影响。
    assert(dispatch(
               R"({"type":"add_component","requestId":"hold-add","kind":"and"})",
               holdCircuit, holdSimulation)
               .find("\"componentId\":5") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-q-after-add","componentId":3,"port":"q"})",
               holdCircuit, holdSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

    // 下一次推进是下降沿：q 按住不动，保留下来的前值继续参与上升沿判定。
    assert(dispatch(
               R"({"type":"set_input","requestId":"hold-clock-low-again","componentId":1,"value":"0"})",
               holdCircuit, holdSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(R"({"type":"tick","requestId":"hold-tick-falling"})", holdCircuit, holdSimulation)
               .find("\"type\":\"ticked\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-q-falling","componentId":3,"port":"q"})",
               holdCircuit, holdSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

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
               .find("\"value\":\"0\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"hold-data-value","componentId":2,"port":"out"})",
               holdCircuit, holdSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

    // set_input 的长度必须等于端口位宽。本票所有端口的位宽恒为 1，因此多位值一律被拒绝，
    // 而且不写入任何状态：被拒之后那个 Input 仍然保持原值。
    circuit::Circuit widthCircuit;
    widthCircuit.addComponent(circuit::ComponentKind::Input);
    std::optional<circuit::Simulation> widthSimulation;
    assert(dispatch(
               R"({"type":"set_input","requestId":"width-one","componentId":1,"value":"1"})",
               widthCircuit, widthSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);

    const auto tooWide = dispatch(
        R"({"type":"set_input","requestId":"width-two","componentId":1,"value":"10"})",
        widthCircuit, widthSimulation);
    assert(tooWide.find("\"code\":\"invalid_width\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"width-read-after-reject","componentId":1,"port":"out"})",
               widthCircuit, widthSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

    // 空串与含其它字符的值连信号值都不是，报的是 invalid_signal 而不是 invalid_width。
    for (const auto& invalidValue : {
             R"({"type":"set_input","requestId":"width-empty","componentId":1,"value":""})",
             R"({"type":"set_input","requestId":"width-digit","componentId":1,"value":"2"})",
             R"({"type":"set_input","requestId":"width-case","componentId":1,"value":"x"})"}) {
        assert(dispatch(invalidValue, widthCircuit, widthSimulation)
                   .find("\"code\":\"invalid_signal\"") != std::string::npos);
    }
    assert(dispatch(
               R"({"type":"get_signal","requestId":"width-charset-read","componentId":1,"port":"out"})",
               widthCircuit, widthSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

    // 数字形式在解析层就已经不被接受，因此到不了位宽校验，报的是请求缺字段。
    assert(dispatch(
               R"({"type":"set_input","requestId":"width-numeric","componentId":1,"value":1})",
               widthCircuit, widthSimulation)
               .find("\"code\":\"bad_request\"") != std::string::npos);

    // ---- 端口清单、位宽与 set_port_width ----

    // 省略端口清单时引擎回退到内置定义，并把实际清单回传。前端因此不必内置一份无人校验的副本。
    const auto addedWithoutPorts = dispatch(
        R"({"type":"add_component","requestId":"ports-builtin","kind":"and"})",
        circuit, simulation);
    assert(addedWithoutPorts.find("\"code\"") == std::string::npos);
    assert(addedWithoutPorts.find("\"componentId\":5") != std::string::npos);
    assert(addedWithoutPorts.find(
               "\"ports\":[{\"name\":\"in1\",\"direction\":\"input\",\"width\":1},"
               "{\"name\":\"in2\",\"direction\":\"input\",\"width\":1},"
               "{\"name\":\"out\",\"direction\":\"output\",\"width\":1}]") != std::string::npos);

    // 携带端口清单时按清单建立，位区间跟着端口一起回传。
    const auto addedWithPorts = dispatch(
        R"({"type":"add_component","requestId":"ports-supplied","kind":"input","ports":[{"name":"out","direction":"output","width":4,"bitRange":{"msb":7,"lsb":4}}]})",
        circuit, simulation);
    assert(addedWithPorts.find("\"code\"") == std::string::npos);
    assert(addedWithPorts.find("\"componentId\":6") != std::string::npos);
    assert(addedWithPorts.find(
               "\"ports\":[{\"name\":\"out\",\"direction\":\"output\",\"width\":4,"
               "\"bitRange\":{\"msb\":7,\"lsb\":4}}]") != std::string::npos);

    const auto wideOutput = dispatch(
        R"({"type":"add_component","requestId":"ports-wide-output","kind":"output","ports":[{"name":"in","direction":"input","width":4}]})",
        circuit, simulation);
    assert(wideOutput.find("\"componentId\":7") != std::string::npos);

    // 长度按目标端口自己声明的位宽判定，不再是常量 1。
    assert(dispatch(
               R"({"type":"set_input","requestId":"set-wide","componentId":6,"value":"10X1"})",
               circuit, simulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"set-wide-wrong-length","componentId":6,"value":"10"})",
               circuit, simulation)
               .find("\"code\":\"invalid_width\"") != std::string::npos);

    // 两端位宽不同直接拒绝，报的是专门的 width_mismatch：不做零扩展、符号扩展或截断。
    const auto widthMismatch = dispatch(
        R"({"type":"add_connection","requestId":"connect-width-mismatch","sourceComponentId":6,"sourcePort":"out","targetComponentId":4,"targetPort":"in"})",
        circuit, simulation);
    assert(widthMismatch.find("\"code\":\"width_mismatch\"") != std::string::npos);

    // 位宽匹配时正常连接，且逐位值原样通过协议往返：某一位未知不影响其余位。
    assert(dispatch(
               R"({"type":"add_connection","requestId":"connect-wide","sourceComponentId":6,"sourcePort":"out","targetComponentId":7,"targetPort":"in"})",
               circuit, simulation)
               .find("\"connectionId\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"settle","requestId":"settle-wide"})", circuit, simulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-wide","componentId":7,"port":"in"})",
               circuit, simulation)
               .find("\"value\":\"10X1\"") != std::string::npos);

    // 改宽是一次整体替换：回传替换后的端口清单，以及因本次改宽而转为悬空的连接。
    const auto widthSet = dispatch(
        R"({"type":"set_port_width","requestId":"widen","componentId":7,"ports":[{"name":"in","direction":"input","width":2}]})",
        circuit, simulation);
    assert(widthSet.find("\"type\":\"port_width_set\"") != std::string::npos);
    assert(widthSet.find("\"componentId\":7") != std::string::npos);
    assert(widthSet.find("\"ports\":[{\"name\":\"in\",\"direction\":\"input\",\"width\":2}]") !=
           std::string::npos);
    assert(widthSet.find("\"danglingConnectionIds\":[4]") != std::string::npos);

    // 改宽后不再匹配的连接不参与仿真：接收端按自己的位宽读到全 X。
    assert(dispatch(
               R"({"type":"settle","requestId":"settle-after-widen"})", circuit, simulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-after-widen","componentId":7,"port":"in"})",
               circuit, simulation)
               .find("\"value\":\"XX\"") != std::string::npos);

    // 改回原宽，连接自动恢复有效，而且不再被报告为「本次转为悬空」。
    const auto widthRestored = dispatch(
        R"({"type":"set_port_width","requestId":"narrow-again","componentId":7,"ports":[{"name":"in","direction":"input","width":4}]})",
        circuit, simulation);
    assert(widthRestored.find("\"danglingConnectionIds\":[]") != std::string::npos);

    // 改宽保留元件身份：同一个 componentId 仍然可用，连接的读数也回来了。
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-restored","componentId":7,"port":"in"})",
               circuit, simulation)
               .find("\"value\":\"10X1\"") != std::string::npos);

    // 端口清单本身的形状与领域规则各有稳定的错误码。
    const auto zeroWidth = dispatch(
        R"({"type":"set_port_width","requestId":"zero-width","componentId":7,"ports":[{"name":"in","direction":"input","width":0}]})",
        circuit, simulation);
    assert(zeroWidth.find("\"code\":\"invalid_width\"") != std::string::npos);

    const auto badRange = dispatch(
        R"({"type":"set_port_width","requestId":"bad-range","componentId":7,"ports":[{"name":"in","direction":"input","width":4,"bitRange":{"msb":2,"lsb":5}}]})",
        circuit, simulation);
    assert(badRange.find("\"code\":\"invalid_bit_range\"") != std::string::npos);

    const auto inconsistentRange = dispatch(
        R"({"type":"set_port_width","requestId":"inconsistent-range","componentId":7,"ports":[{"name":"in","direction":"input","width":3,"bitRange":{"msb":7,"lsb":4}}]})",
        circuit, simulation);
    assert(inconsistentRange.find("\"code\":\"invalid_bit_range\"") != std::string::npos);

    const auto badDirection = dispatch(
        R"({"type":"set_port_width","requestId":"bad-direction","componentId":7,"ports":[{"name":"in","direction":"sideways","width":1}]})",
        circuit, simulation);
    assert(badDirection.find("\"code\":\"bad_request\"") != std::string::npos);

    const auto duplicateName = dispatch(
        R"({"type":"set_port_width","requestId":"duplicate-name","componentId":7,"ports":[{"name":"in","direction":"input","width":1},{"name":"in","direction":"input","width":2}]})",
        circuit, simulation);
    assert(duplicateName.find("\"code\":\"bad_request\"") != std::string::npos);

    // ports 字段存在但形状不合法，与「省略该字段」必须区分开：前者是一次应当被拒绝的请求。
    const auto malformedPorts = dispatch(
        R"({"type":"set_port_width","requestId":"malformed-ports","componentId":7,"ports":5})",
        circuit, simulation);
    assert(malformedPorts.find("\"code\":\"bad_request\"") != std::string::npos);

    const auto malformedPortElement = dispatch(
        R"({"type":"add_component","requestId":"malformed-element","kind":"input","ports":[{"direction":"output","width":1}]})",
        circuit, simulation);
    assert(malformedPortElement.find("\"code\":\"bad_request\"") != std::string::npos);

    const auto missingPortsField = dispatch(
        R"({"type":"set_port_width","requestId":"missing-ports","componentId":7})",
        circuit, simulation);
    assert(missingPortsField.find("\"code\":\"bad_request\"") != std::string::npos);

    const auto unknownComponentForWidth = dispatch(
        R"({"type":"set_port_width","requestId":"unknown-width-component","componentId":99,"ports":[{"name":"in","direction":"input","width":1}]})",
        circuit, simulation);
    assert(unknownComponentForWidth.find("\"code\":\"component_not_found\"") != std::string::npos);

    // 失败的请求不留下半成品：被拒之后端口清单仍是上一次成功的那一份。
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-after-rejects","componentId":7,"port":"in"})",
               circuit, simulation)
               .find("\"value\":\"10X1\"") != std::string::npos);

    // 位区间是端口自己的属性，跟着清单一起走。
    const auto rangedPort = dispatch(
        R"({"type":"set_port_width","requestId":"branch-range","componentId":7,"ports":[{"name":"in","direction":"input","width":4,"bitRange":{"msb":3,"lsb":0}}]})",
        circuit, simulation);
    assert(rangedPort.find("\"bitRange\":{\"msb\":3,\"lsb\":0}") != std::string::npos);

    // 解析层要认得出嵌套结构：端口名与某个键名相同不能被当成那个键。
    const auto nestedNames = circuit::protocol::parseRequest(
        R"({"type":"add_component","requestId":"nested","kind":"input","ports":[{"name":"bitRange","direction":"output","width":2,"bitRange":{"msb":1,"lsb":0}}]})");
    assert(nestedNames.has_value());
    assert(nestedNames->ports.present);
    assert(nestedNames->ports.wellFormed);
    assert(nestedNames->ports.ports.size() == 1);
    assert(nestedNames->ports.ports[0].name == "bitRange");
    assert(nestedNames->ports.ports[0].direction == "output");
    assert(nestedNames->ports.ports[0].width == 2);
    assert(nestedNames->ports.ports[0].bitRange.has_value());
    assert(nestedNames->ports.ports[0].bitRange->msb == 1);
    assert(nestedNames->ports.ports[0].bitRange->lsb == 0);

    // 省略 ports 字段时 present 为假，与「声明了一份空清单」区分开。
    const auto withoutPortsField = circuit::protocol::parseRequest(
        R"({"type":"add_component","requestId":"absent","kind":"input"})");
    assert(withoutPortsField.has_value());
    assert(!withoutPortsField->ports.present);

    const auto withEmptyPorts = circuit::protocol::parseRequest(
        R"({"type":"add_component","requestId":"empty","kind":"input","ports":[]})");
    assert(withEmptyPorts.has_value());
    assert(withEmptyPorts->ports.present);
    assert(withEmptyPorts->ports.wellFormed);
    assert(withEmptyPorts->ports.ports.empty());

    // ---- 拆线器与合线器：形状由数据决定，清单必须随请求给出 ----

    circuit::Circuit busCircuit;
    std::optional<circuit::Simulation> busSimulation;

    // 数据驱动的元件没有内置定义：省略清单就没有可回退的形状，这是一条应当被拒绝的请求。
    // 内置元件相反——省略清单正是「引擎回退到内置定义」。
    const auto splitterWithoutPorts = dispatch(
        R"({"type":"add_component","requestId":"splitter-no-ports","kind":"splitter"})",
        busCircuit, busSimulation);
    assert(splitterWithoutPorts.find("\"code\":\"bad_request\"") != std::string::npos);
    assert(splitterWithoutPorts.find("缺少字段: ports") != std::string::npos);

    // 默认的 8 位拆线器：一条 8 位输入加八条 1 位分支，回传的清单里带着每条分支的位区间。
    const auto splitter = dispatch(
        R"({"type":"add_component","requestId":"add-splitter","kind":"splitter","ports":[{"name":"in","direction":"input","width":8},{"name":"out0","direction":"output","width":1,"bitRange":{"msb":7,"lsb":7}},{"name":"out1","direction":"output","width":1,"bitRange":{"msb":6,"lsb":6}},{"name":"out2","direction":"output","width":1,"bitRange":{"msb":5,"lsb":5}},{"name":"out3","direction":"output","width":1,"bitRange":{"msb":4,"lsb":4}},{"name":"out4","direction":"output","width":1,"bitRange":{"msb":3,"lsb":3}},{"name":"out5","direction":"output","width":1,"bitRange":{"msb":2,"lsb":2}},{"name":"out6","direction":"output","width":1,"bitRange":{"msb":1,"lsb":1}},{"name":"out7","direction":"output","width":1,"bitRange":{"msb":0,"lsb":0}}]})",
        busCircuit, busSimulation);
    assert(splitter.find("\"type\":\"component_added\"") != std::string::npos);
    assert(splitter.find("\"componentId\":1") != std::string::npos);
    assert(splitter.find("\"name\":\"out7\",\"direction\":\"output\",\"width\":1,"
                         "\"bitRange\":{\"msb\":0,\"lsb\":0}") != std::string::npos);

    const auto wideSource = dispatch(
        R"({"type":"add_component","requestId":"add-wide-source","kind":"input","ports":[{"name":"out","direction":"output","width":8}]})",
        busCircuit, busSimulation);
    assert(wideSource.find("\"componentId\":2") != std::string::npos);

    // 位区间决定分支的位宽：分支端口的位宽必须等于它声明的区间长度，不一致时拒绝。
    assert(dispatch(
               R"({"type":"add_component","requestId":"branch-width-mismatch","kind":"splitter","ports":[{"name":"in","direction":"input","width":4},{"name":"out0","direction":"output","width":3,"bitRange":{"msb":3,"lsb":0}}]})",
               busCircuit, busSimulation)
               .find("\"code\":\"invalid_bit_range\"") != std::string::npos);

    // 越界、重叠、漏位各自被拒绝，且文案各不相同——用户需要知道是哪一种。
    const auto incomplete = dispatch(
        R"({"type":"add_component","requestId":"splitter-hole","kind":"splitter","ports":[{"name":"in","direction":"input","width":8},{"name":"out0","direction":"output","width":4,"bitRange":{"msb":7,"lsb":4}},{"name":"out1","direction":"output","width":3,"bitRange":{"msb":2,"lsb":0}}]})",
        busCircuit, busSimulation);
    assert(incomplete.find("\"code\":\"invalid_bit_range\"") != std::string::npos);
    assert(incomplete.find("不能漏位") != std::string::npos);

    const auto overlap = dispatch(
        R"({"type":"add_component","requestId":"splitter-overlap","kind":"splitter","ports":[{"name":"in","direction":"input","width":8},{"name":"out0","direction":"output","width":4,"bitRange":{"msb":7,"lsb":4}},{"name":"out1","direction":"output","width":5,"bitRange":{"msb":4,"lsb":0}}]})",
        busCircuit, busSimulation);
    assert(overlap.find("\"code\":\"invalid_bit_range\"") != std::string::npos);
    assert(overlap.find("不能互相重叠") != std::string::npos);

    const auto outOfRange = dispatch(
        R"({"type":"add_component","requestId":"splitter-overflow","kind":"splitter","ports":[{"name":"in","direction":"input","width":8},{"name":"out0","direction":"output","width":9,"bitRange":{"msb":8,"lsb":0}}]})",
        busCircuit, busSimulation);
    assert(outOfRange.find("\"code\":\"invalid_bit_range\"") != std::string::npos);
    assert(outOfRange.find("越出了宿主总线") != std::string::npos);

    // 被拒绝的三次尝试都没有建立元件：下一个建成的元件仍然是 3 号。
    const auto merger = dispatch(
        R"({"type":"add_component","requestId":"add-merger","kind":"merger","ports":[{"name":"in0","direction":"input","width":4,"bitRange":{"msb":7,"lsb":4}},{"name":"in1","direction":"input","width":4,"bitRange":{"msb":3,"lsb":0}},{"name":"out","direction":"output","width":8}]})",
        busCircuit, busSimulation);
    assert(merger.find("\"type\":\"component_added\"") != std::string::npos);
    assert(merger.find("\"componentId\":3") != std::string::npos);

    // 逐位搬运能被外部看见：一位未知只污染拿到它的那条分支。
    assert(dispatch(
               R"({"type":"add_connection","requestId":"bus-in","sourceComponentId":2,"sourcePort":"out","targetComponentId":1,"targetPort":"in"})",
               busCircuit, busSimulation)
               .find("\"connectionId\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"bus-value","componentId":2,"value":"10X10010"})",
               busCircuit, busSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(R"({"type":"settle","requestId":"bus-settle"})", busCircuit, busSimulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-bit2","componentId":1,"port":"out2"})",
               busCircuit, busSimulation)
               .find("\"value\":\"X\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-bit0","componentId":1,"port":"out0"})",
               busCircuit, busSimulation)
               .find("\"value\":\"1\"") != std::string::npos);

    // 一条分支接上一个 1 位接收端，用来观察改位区间之后它会不会悬空。
    assert(dispatch(
               R"({"type":"add_component","requestId":"add-bit-sink","kind":"output"})",
               busCircuit, busSimulation)
               .find("\"componentId\":4") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_connection","requestId":"sink-top-bit","sourceComponentId":1,"sourcePort":"out0","targetComponentId":4,"targetPort":"in"})",
               busCircuit, busSimulation)
               .find("\"connectionId\":2") != std::string::npos);

    // 合线器反向搬运：两条 4 位分支拼回一条 8 位总线。
    assert(dispatch(
               R"({"type":"add_component","requestId":"add-high","kind":"input","ports":[{"name":"out","direction":"output","width":4}]})",
               busCircuit, busSimulation)
               .find("\"componentId\":5") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_component","requestId":"add-low","kind":"input","ports":[{"name":"out","direction":"output","width":4}]})",
               busCircuit, busSimulation)
               .find("\"componentId\":6") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_connection","requestId":"merge-high","sourceComponentId":5,"sourcePort":"out","targetComponentId":3,"targetPort":"in0"})",
               busCircuit, busSimulation)
               .find("\"connectionId\":3") != std::string::npos);
    assert(dispatch(
               R"({"type":"add_connection","requestId":"merge-low","sourceComponentId":6,"sourcePort":"out","targetComponentId":3,"targetPort":"in1"})",
               busCircuit, busSimulation)
               .find("\"connectionId\":4") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"high-value","componentId":5,"value":"10X1"})",
               busCircuit, busSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"set_input","requestId":"low-value","componentId":6,"value":"0010"})",
               busCircuit, busSimulation)
               .find("\"type\":\"input_set\"") != std::string::npos);
    assert(dispatch(R"({"type":"settle","requestId":"merge-settle"})", busCircuit, busSimulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-bus","componentId":3,"port":"out"})",
               busCircuit, busSimulation)
               .find("\"value\":\"10X10010\"") != std::string::npos);

    // 改位区间是整体替换：回传替换后的清单，以及被这次变更挤成悬空的连接。
    const auto rebranched = dispatch(
        R"({"type":"set_port_width","requestId":"rebranch","componentId":3,"ports":[{"name":"in0","direction":"input","width":8,"bitRange":{"msb":7,"lsb":0}},{"name":"out","direction":"output","width":8}]})",
        busCircuit, busSimulation);
    assert(rebranched.find("\"type\":\"port_width_set\"") != std::string::npos);
    assert(rebranched.find("\"ports\":[{\"name\":\"in0\",\"direction\":\"input\",\"width\":8,"
                           "\"bitRange\":{\"msb\":7,\"lsb\":0}},"
                           "{\"name\":\"out\",\"direction\":\"output\",\"width\":8}]") !=
           std::string::npos);
    // 两条 4 位分支被一条 8 位分支取代：原来接在 in1 上的那条连接因为端点消失而悬空，in0 上的
    // 那条因为宽度从 4 变成 8 而悬空——两者都是本次变更造成的，因此都在回传的差分里。
    assert(rebranched.find("\"danglingConnectionIds\":[3,4]") != std::string::npos);

    // 八条 1 位分支改成一条 8 位分支：分支名与位宽都跟着清单走，原来接在 out0 上的那条连接
    // 因为两端位宽不再相同而悬空。
    const auto resplit = dispatch(
        R"({"type":"set_port_width","requestId":"resplit","componentId":1,"ports":[{"name":"in","direction":"input","width":8},{"name":"out0","direction":"output","width":8,"bitRange":{"msb":7,"lsb":0}}]})",
        busCircuit, busSimulation);
    assert(resplit.find("\"type\":\"port_width_set\"") != std::string::npos);
    assert(resplit.find("\"danglingConnectionIds\":[2]") != std::string::npos);

    const auto rejectedResplit = dispatch(
        R"({"type":"set_port_width","requestId":"bad-resplit","componentId":1,"ports":[{"name":"in","direction":"input","width":8},{"name":"out0","direction":"output","width":4,"bitRange":{"msb":7,"lsb":4}},{"name":"out1","direction":"output","width":1,"bitRange":{"msb":4,"lsb":4}}]})",
        busCircuit, busSimulation);
    assert(rejectedResplit.find("\"code\":\"invalid_bit_range\"") != std::string::npos);

    // 半成品快照的判据：被拒之后拆线器仍然只有 out0 那一条 8 位分支，读数与提交前一致。
    // 改位区间按初值重建了分支端口，因此先求值一次再读。
    assert(dispatch(R"({"type":"settle","requestId":"settle-after-resplit"})", busCircuit, busSimulation)
               .find("\"type\":\"settled\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-after-bad-resplit","componentId":1,"port":"out0"})",
               busCircuit, busSimulation)
               .find("\"value\":\"10X10010\"") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-gone-branch","componentId":1,"port":"out1"})",
               busCircuit, busSimulation)
               .find("\"code\":\"port_not_found\"") != std::string::npos);

    return 0;
}
