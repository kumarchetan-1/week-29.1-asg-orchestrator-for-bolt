import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, SetDesiredCapacityCommand, TerminateInstanceInAutoScalingGroupCommand } from "@aws-sdk/client-auto-scaling";
import express from "express"
import dotenv from "dotenv";

dotenv.config();


const asgClient = new AutoScalingClient({
    region: "eu-north-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY!,
        secretAccessKey: process.env.AWS_ACCESS_SECRET_KEY!
    }
})

const ec2Client = new EC2Client({
    region: "eu-north-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY!,
        secretAccessKey: process.env.AWS_ACCESS_SECRET_KEY!
    }
})

type Machine = {
    isUsed: boolean
    ipAddress: string
    assignedProject: string | null
}

const ALL_MACHINES: Machine[] = []

async function setAllMachineInstances() {
    const asgCommand = new DescribeAutoScalingGroupsCommand()
    const data = await asgClient.send(asgCommand)
    const instanceIds =
        (data.AutoScalingGroups ?? [])
            .flatMap(group =>
                (group.Instances ?? []).map(i => i.InstanceId).filter(id=> typeof id === "string")
            );
            
  const ec2InstanceCommand = new DescribeInstancesCommand({
    InstanceIds: instanceIds
  })

  const ec2Response =  await ec2Client.send(ec2InstanceCommand)
  const instanceIps = (ec2Response.Reservations?? [])
                      .flatMap(res=> res.Instances ?? [])
                      .map(instance => instance.PublicIpAddress)
                      .filter(ip => typeof ip === "string")

  instanceIps.forEach(ip=>{
    ALL_MACHINES.push({
        ipAddress: ip,
        isUsed: false,
        assignedProject: null
    })
  })
  console.log(ALL_MACHINES);
}

const app = express()

app.get("/:projectId", async(req, res)=>{
    const projectId = req.params.projectId;
    let idleMachine = ALL_MACHINES.find(x => x.isUsed === false)
    if (!idleMachine) {
        res.send("No idle machine found")
        return
    }

    idleMachine.isUsed = true
    idleMachine.assignedProject = projectId

    const setDesiredCmd = new SetDesiredCapacityCommand({
        AutoScalingGroupName: "vscode-asg",
        DesiredCapacity: ALL_MACHINES.length + (5- ALL_MACHINES.filter(x=> x.isUsed == false).length)
    })

    const data = await asgClient.send(setDesiredCmd)
    console.log(data);
    
    res.json({
        ip: idleMachine.ipAddress
    })
})

app.get("/destroy", async(req, res)=>{
    const machineId = req.body.machineId;
    const command = new TerminateInstanceInAutoScalingGroupCommand({
        InstanceId: machineId,
        ShouldDecrementDesiredCapacity: true
    })

    const response = await asgClient.send(command)

})

setAllMachineInstances()