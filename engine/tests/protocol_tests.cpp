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

    const auto secondTick = dispatch(
        R"({"type":"tick","requestId":"tick-2"})", clockCircuit, clockSimulation);
    assert(secondTick.find("\"step\":2") != std::string::npos);
    assert(secondTick.find(
               "{\"componentId\":1,\"port\":\"out\",\"value\":0}") != std::string::npos);
    assert(secondTick.find(
               "{\"componentId\":2,\"port\":\"out\",\"value\":1}") != std::string::npos);
    assert(dispatch(
               R"({"type":"get_signal","requestId":"read-after-tick","componentId":3,"port":"in"})",
               clockCircuit, clockSimulation)
               .find("\"value\":1") != std::string::npos);

    circuit::Circuit loopCircuit;
    const auto loopFirst = loopCircuit.addComponent(circuit::ComponentKind::NotGate);
    const auto loopSecond = loopCircuit.addComponent(circuit::ComponentKind::NotGate);
    assert(loopCircuit.addConnection({loopFirst, "out"}, {loopSecond, "in"}).succeeded());
    assert(loopCircuit.addConnection({loopSecond, "out"}, {loopFirst, "in"}).succeeded());
    std::optional<circuit::Simulation> loopSimulation;
    assert(dispatch(R"({"type":"tick","requestId":"tick-loop"})", loopCircuit, loopSimulation)
               .find("\"code\":\"combinational_loop\"") != std::string::npos);

    return 0;
}
